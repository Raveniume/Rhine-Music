use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::Path, time::{Duration, Instant}};
use sha2::{Digest, Sha256};

const MAX_BYTES: u64 = 512 * 1024 * 1024;

fn verified(path: &Path, expected: &str) -> Result<bool, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()).eq_ignore_ascii_case(expected))
}

// Only a complete, verified file receives the executable name. Interrupted
// transfers remain resumable; they can never reach the installer handoff.
pub fn download(url: &str, target: &Path, expected: &str, mut progress: impl FnMut(String)) -> Result<(), String> {
    if target.is_file() && verified(target, expected)? { return Ok(()); }
    let partial = target.with_extension("exe.part");
    let client = reqwest::blocking::Client::builder()
        .user_agent("RhineMusic-Updater/1")
        .connect_timeout(Duration::from_secs(15))
        // The blocking client applies this timeout to each read, not the whole
        // download. A slow but active connection can finish large installers.
        .timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    for attempt in 0..3 {
        let offset = fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
        if offset > MAX_BYTES { let _ = fs::remove_file(&partial); return Err("安装包超过大小限制".into()); }
        if offset > 0 && verified(&partial, expected)? { return promote(&partial, target); }
        progress(if attempt == 0 { "正在连接下载服务器…".into() } else { format!("下载中断，正在重连（{attempt}/2）…") });
        let result = transfer(&client, url, &partial, offset, &mut progress);
        match result {
            Ok(()) => {
                progress("下载完成，正在校验安装包…".into());
                if verified(&partial, expected)? { return promote(&partial, target); }
                let _ = fs::remove_file(&partial);
                return Err("安装包校验失败，已清除文件，请重试".into());
            }
            Err(error) => last_error = error,
        }
    }
    Err(format!("下载连接中断，已保留进度，重试时继续下载（{last_error}）"))
}

fn promote(partial: &Path, target: &Path) -> Result<(), String> {
    if target.exists() { fs::remove_file(target).map_err(|e| e.to_string())?; }
    fs::rename(partial, target).map_err(|e| e.to_string())
}

fn transfer(client: &reqwest::blocking::Client, url: &str, partial: &Path, offset: u64, progress: &mut impl FnMut(String)) -> Result<(), String> {
    let mut request = client.get(url).header(reqwest::header::ACCEPT_ENCODING, "identity");
    if offset > 0 { request = request.header(reqwest::header::RANGE, format!("bytes={offset}-")); }
    let mut response = request.send().map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let _ = fs::remove_file(partial);
        return Err("服务器不接受已有下载进度，将重新下载".into());
    }
    response.error_for_status_ref().map_err(|e| e.to_string())?;
    let (start, total) = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        let range = response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|h| h.to_str().ok()).ok_or("断点响应缺少范围")?;
        let (start, end, total) = parse_range(range).ok_or("断点响应范围无效")?;
        if start != offset || response.content_length().is_some_and(|n| n != end - start + 1) { return Err("断点响应与下载进度不一致".into()); }
        (start, Some(total))
    } else if response.status() == reqwest::StatusCode::OK {
        (0, response.content_length()) // A server may ignore Range: restart safely.
    } else { return Err(format!("不支持的下载响应 {}", response.status())); };
    if total.is_some_and(|n| n > MAX_BYTES) { return Err("安装包超过大小限制".into()); }
    let mut file = OpenOptions::new().create(true).write(true).truncate(start == 0).append(start > 0).open(partial).map_err(|e| e.to_string())?;
    let mut received = start;
    let mut buffer = [0u8; 64 * 1024];
    let began = Instant::now();
    let mut last_notice = Instant::now() - Duration::from_secs(1);
    loop {
        if began.elapsed() > Duration::from_secs(20 * 60) { return Err("下载耗时过长".into()); }
        let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        received += count as u64;
        if received > MAX_BYTES || total.is_some_and(|n| received > n) { return Err("安装包长度无效".into()); }
        file.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        if last_notice.elapsed() >= Duration::from_millis(250) {
            let mib = received as f64 / 1048576.0;
            progress(match total.filter(|n| *n > 0) {
                Some(n) => format!("正在下载：{:.0}% · {mib:.1} / {:.1} MiB", received as f64 * 100.0 / n as f64, n as f64 / 1048576.0),
                None => format!("正在下载：{mib:.1} MiB"),
            });
            last_notice = Instant::now();
        }
    }
    if total.is_some_and(|n| received != n) { return Err("安装包下载不完整".into()); }
    file.sync_all().map_err(|e| e.to_string())
}

fn parse_range(value: &str) -> Option<(u64, u64, u64)> {
    let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let (start, end, total) = (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    (start <= end && end < total).then_some((start, end, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("rhine-update-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap(); Self(path)
        }
        fn target(&self) -> std::path::PathBuf { self.0.join("test.exe") }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn server(responses: Vec<&'static str>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/installer", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            responses.into_iter().map(|response| {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
                stream.write_all(response.as_bytes()).unwrap();
                String::from_utf8(request).unwrap().to_lowercase()
            }).collect()
        });
        (url, handle)
    }
    fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

    #[test]
    fn interrupted_download_resumes_and_verifies_before_promotion() {
        let fixture = Fixture::new();
        let target = fixture.target();
        let (url, server) = server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc",
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef",
        ]);
        let mut messages = Vec::new();
        download(&url, &target, &hash(b"abcdef"), |m| { assert!(!target.exists()); messages.push(m); }).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"abcdef");
        assert!(!target.with_extension("exe.part").exists());
        assert!(server.join().unwrap()[1].contains("range: bytes=3-"));
        assert!(messages.iter().any(|m| m.contains("重连")));
    }
    #[test]
    fn ignored_range_restarts_instead_of_appending() {
        let fixture = Fixture::new(); let target = fixture.target();
        fs::write(target.with_extension("exe.part"), b"abc").unwrap();
        let (url, server) = server(vec!["HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef"]);
        download(&url, &target, &hash(b"abcdef"), |_| {}).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"abcdef"); server.join().unwrap();
    }
    #[test]
    fn corrupt_download_never_becomes_executable() {
        let fixture = Fixture::new(); let target = fixture.target();
        let (url, server) = server(vec!["HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad"]);
        assert!(download(&url, &target, &hash(b"good"), |_| {}).unwrap_err().contains("校验失败"));
        assert!(!target.exists()); assert!(!target.with_extension("exe.part").exists()); server.join().unwrap();
    }
    #[test]
    fn failed_retries_preserve_partial_for_next_attempt() {
        let fixture = Fixture::new(); let target = fixture.target();
        fs::write(target.with_extension("exe.part"), b"abc").unwrap();
        let (url, server) = server(vec!["HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"; 3]);
        assert!(download(&url, &target, &hash(b"abcdef"), |_| {}).is_err());
        assert_eq!(fs::read(target.with_extension("exe.part")).unwrap(), b"abc");
        assert!(!target.exists()); server.join().unwrap();
    }
    #[test]
    fn range_validation_and_verified_cache() {
        assert_eq!(parse_range("bytes 3-5/6"), Some((3, 5, 6)));
        for bad in ["bytes 5-3/6", "bytes 3-6/6", "bytes 3-5/*", "bytes */6"] { assert!(parse_range(bad).is_none()); }
        let fixture = Fixture::new(); let target = fixture.target();
        fs::write(&target, b"abcdef").unwrap();
        download("http://127.0.0.1:1/never-requested", &target, &hash(b"abcdef"), |_| {}).unwrap();
    }
}
