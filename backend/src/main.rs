//! 独立的排班数据后端（零第三方依赖，纯标准库 HTTP/1.1 服务器）。
//!
//! 提供与 Tauri command 语义一致的两个接口：
//! - `GET  /load_data`  —— 返回已保存的整包数据（JSON 文本）；无数据时返回 204。
//! - `POST /save_data`  —— 用请求体（JSON 文本）覆盖保存数据。
//! - `GET  /health`     —— 健康检查。
//!
//! 数据以文件形式保存在“运行目录”（启动时的当前工作目录）下的
//! `dnf_schedule_data.json`。
//!
//! 地址默认 `127.0.0.1:8899`，可用环境变量 `DNF_BACKEND_ADDR` 覆盖，例如：
//!   DNF_BACKEND_ADDR=127.0.0.1:8899
//! 或作为第一个命令行参数传入。

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;

/// 数据文件名（保存于运行目录）
const DATA_FILE: &str = "dnf_schedule_data.json";
/// 请求体大小上限：64MB，防止恶意超大请求
const MAX_BODY: usize = 64 * 1024 * 1024;

fn data_path() -> PathBuf {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join(DATA_FILE)
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "200 OK",
        204 => "204 No Content",
        400 => "400 Bad Request",
        404 => "404 Not Found",
        405 => "405 Method Not Allowed",
        413 => "413 Payload Too Large",
        500 => "500 Internal Server Error",
        _ => "200 OK",
    }
}

fn write_response(stream: &mut TcpStream, code: u16, content_type: &str, body: &[u8]) {
    let _ = write_all(stream, format!("HTTP/1.1 {}\r\n", reason(code)).as_bytes());
    let _ = write_all(stream, b"Server: dnf-backend\r\n");
    let _ = write_all(stream, b"Connection: close\r\n");
    // CORS：允许 Vite dev(1420) 等本地前端跨域调用
    let _ = write_all(stream, b"Access-Control-Allow-Origin: *\r\n");
    let _ = write_all(
        stream,
        b"Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n",
    );
    let _ = write_all(stream, b"Access-Control-Allow-Headers: Content-Type\r\n");
    if !body.is_empty() {
        let _ = write_all(stream, format!("Content-Type: {}\r\n", content_type).as_bytes());
    }
    let _ = write_all(stream, format!("Content-Length: {}\r\n", body.len()).as_bytes());
    let _ = write_all(stream, b"\r\n");
    let _ = write_all(stream, body);
    let _ = stream.flush();
}

fn write_all(stream: &mut TcpStream, data: &[u8]) -> std::io::Result<()> {
    stream.write_all(data)
}

fn handle_client(mut stream: TcpStream) {
    let mut reader = match stream.try_clone() {
        Ok(r) => BufReader::new(r),
        Err(_) => return,
    };

    // 请求行：`METHOD /path HTTP/1.1`
    let mut req_line = String::new();
    if reader.read_line(&mut req_line).map(|n| n == 0).unwrap_or(true) {
        return;
    }
    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 3 {
        write_response(&mut stream, 400, "text/plain", b"bad request");
        return;
    }
    let method = parts[0];
    let path = parts[1].split('?').next().unwrap_or(parts[1]);

    // 请求头（只关心 Content-Length）
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map(|n| n == 0).unwrap_or(true) {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }

    // CORS 预检
    if method == "OPTIONS" {
        write_response(&mut stream, 204, "text/plain", b"");
        return;
    }

    // 读取请求体
    if content_length > MAX_BODY {
        write_response(&mut stream, 413, "text/plain", b"payload too large");
        return;
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).is_err() {
        write_response(&mut stream, 400, "text/plain", b"read body failed");
        return;
    }

    match (method, path) {
        ("GET", "/health") => {
            write_response(&mut stream, 200, "text/plain", b"ok");
        }
        ("GET", "/load_data") => {
            let p = data_path();
            if !p.exists() {
                write_response(&mut stream, 204, "text/plain", b"");
                return;
            }
            match fs::read(&p) {
                Ok(data) => write_response(&mut stream, 200, "application/json", &data),
                Err(e) => write_response(
                    &mut stream,
                    500,
                    "text/plain",
                    format!("read failed: {e}").as_bytes(),
                ),
            }
        }
        ("POST", "/save_data") => {
            let p = data_path();
            match fs::write(&p, &body) {
                Ok(()) => write_response(&mut stream, 200, "text/plain", b"saved"),
                Err(e) => write_response(
                    &mut stream,
                    500,
                    "text/plain",
                    format!("write failed: {e}").as_bytes(),
                ),
            }
        }
        _ => {
            write_response(&mut stream, 404, "text/plain", b"not found");
        }
    }
}

fn main() {
    let addr = env::var("DNF_BACKEND_ADDR").unwrap_or_else(|_| {
        env::args()
            .nth(1)
            .unwrap_or_else(|| "127.0.0.1:8899".to_string())
    });

    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("绑定监听地址失败 {addr}: {e}");
            std::process::exit(1);
        }
    };
    println!("dnf-backend 已启动");
    println!("  监听:      http://{addr}");
    println!("  GET  /load_data   读取数据（无数据时 204）");
    println!("  POST /save_data   保存数据（请求体=JSON 文本）");
    println!("  GET  /health      健康检查");
    println!("  数据文件:  {}", data_path().display());

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                thread::spawn(move || handle_client(s));
            }
            Err(_) => continue,
        }
    }
}
