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
//! 简单日志：对数据文件的每次读/写（CRUD）会追加一行到运行目录下的
//! `dnf_backend.log`（时间戳 + 操作 + 结果 + 字节数）。
//! 日志按大小轮转：单个文件满 5MB 时顺移为 .1/.2…（.N 最旧），
//! 全部日志总大小不超过 100MB，超出自动删除最旧文件。
//!
//! 地址默认 `127.0.0.1:8899`，可用环境变量 `DNF_BACKEND_ADDR` 覆盖，例如：
//!   DNF_BACKEND_ADDR=127.0.0.1:8899
//! 或作为第一个命令行参数传入。

use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

/// 数据文件名（保存于运行目录）
const DATA_FILE: &str = "dnf_schedule_data.json";
/// 日志文件名（保存于运行目录，记录对数据文件的 CRUD 操作）
const LOG_FILE: &str = "dnf_backend.log";
/// 单个日志文件达到该大小即轮转（主文件 → .1，旧文件依次顺移 .1→.2 …）
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024; // 5MB
/// 全部日志文件（含 .1/.2…）总大小上限，超出则删除最旧文件
const LOG_TOTAL_CAP: u64 = 100 * 1024 * 1024; // 100MB
/// 请求体大小上限：64MB，防止恶意超大请求
const MAX_BODY: usize = 64 * 1024 * 1024;

fn data_path() -> PathBuf {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join(DATA_FILE)
}

fn log_path() -> PathBuf {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join(LOG_FILE)
}

/// 以 UTC 生成可读时间戳 `YYYY-MM-DD HH:MM:SS`
fn now_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    // 公历转换（civil_from_days），无第三方依赖
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) as i64 / 365;
    let y = yoe + era * 400;
    let doy = doe as i64 - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as i64;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, hh, mm, ss)
}

/// 主日志文件带后缀的名称（.1 最新旧文件，数字越大越旧）
fn suffixed_log(n: u32) -> PathBuf {
    PathBuf::from(format!("{}.{}", log_path().display(), n))
}

/// 最大的已存在后缀编号（0 表示还没有 .1）
fn highest_suffix() -> u32 {
    let mut n = 0u32;
    while suffixed_log(n + 1).exists() {
        n += 1;
    }
    n
}

/// 全部日志文件（主文件 + .1/.2…）的总字节数
fn total_log_bytes() -> u64 {
    let mut sum = fs::metadata(log_path()).map(|m| m.len()).unwrap_or(0);
    let mut i = 1u32;
    while let Ok(m) = fs::metadata(suffixed_log(i)) {
        sum += m.len();
        i += 1;
    }
    sum
}

/// 删除最旧的一个日志文件（数字最大的后缀）；返回是否删了
fn drop_oldest_log() -> bool {
    let n = highest_suffix();
    if n == 0 {
        return false;
    }
    fs::remove_file(suffixed_log(n)).is_ok()
}

/// 写日志前先按大小轮转 / 清理，保证：单文件 ≤ LOG_ROTATE_BYTES、总大小 ≤ LOG_TOTAL_CAP
fn rotate_logs() {
    let main = log_path();
    let big = fs::metadata(&main)
        .map(|m| m.len() >= LOG_ROTATE_BYTES)
        .unwrap_or(false);
    if big {
        // 先删最旧文件腾出位子，再把 .N-1→.N … .1→.2，最后主文件 → .1
        let n = highest_suffix();
        if n >= 1 {
            let _ = fs::remove_file(suffixed_log(n));
        }
        for i in (1..=n.saturating_sub(1)).rev() {
            let _ = fs::rename(suffixed_log(i), suffixed_log(i + 1));
        }
        let _ = fs::rename(&main, suffixed_log(1));
    }
    // 总大小仍超上限时，继续删除最旧文件直到达标
    let mut guard = 0;
    while total_log_bytes() > LOG_TOTAL_CAP && guard < 128 {
        if !drop_oldest_log() {
            break;
        }
        guard += 1;
    }
}

/// 追加一行日志（时间戳 + 内容），日志文件不存在则自动创建；写前按大小轮转
fn append_log(msg: &str) {
    rotate_logs();
    let line = format!("[{}] {}", now_utc(), msg);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "{}", line);
    }
    // 同时回显到控制台，便于前台运行时观察
    eprintln!("{}", line);
}

/* ---------------- 写入前的数据增删对比 ---------------- */
/// 取对象的主键：优先 id，其次用 fallback 字段（如 nickname）
fn obj_key(o: &serde_json::Value, fallback: &str) -> String {
    o.get("id")
        .and_then(|x| x.as_str())
        .or_else(|| o.get(fallback).and_then(|x| x.as_str()))
        .unwrap_or_default()
        .to_string()
}

fn nick_of(o: &serde_json::Value) -> String {
    o.get("nickname")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string()
}

fn arr_of<'a>(root: &'a serde_json::Value, key: &str) -> Vec<&'a serde_json::Value> {
    root.get(key)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

/// 按主键建索引（member 用 id/nickname，character 用 id/nickname）
fn index_map<'a>(
    root: &'a serde_json::Value,
    key: &str,
    fallback: &str,
) -> HashMap<String, &'a serde_json::Value> {
    let mut m = HashMap::new();
    for o in arr_of(root, key) {
        let k = obj_key(o, fallback);
        if !k.is_empty() {
            m.insert(k, o);
        }
    }
    m
}

fn join_list(items: &[String]) -> String {
    const CAP: usize = 1200;
    let mut s = String::new();
    for (i, it) in items.iter().enumerate() {
        let add = if i == 0 { it.clone() } else { format!("、{it}") };
        if s.len() + add.len() > CAP {
            s.push('…');
            break;
        }
        s.push_str(&add);
    }
    s
}

fn diff_label(added: &[String], removed: &[String], kind: &str) -> Option<String> {
    let mut parts = Vec::new();
    if !added.is_empty() {
        parts.push(format!("新增{kind} {}", join_list(added)));
    }
    if !removed.is_empty() {
        parts.push(format!("删除{kind} {}", join_list(removed)));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("；"))
    }
}

/// 对比整包 JSON 的新旧内容，返回本次“添加/删除”了什么（可读摘要）
fn describe_changes(old_raw: Option<&str>, new_raw: &str) -> Option<String> {
    let new: serde_json::Value = serde_json::from_str(new_raw).ok()?;
    let m_total = arr_of(&new, "members").len();
    let c_total: usize = arr_of(&new, "members")
        .iter()
        .map(|m| arr_of(m, "characters").len())
        .sum();
    let Some(old_text) = old_raw else {
        // 之前没有数据文件 → 首次全量建立，只报总量
        return Some(format!(
            "DIFF 数据文件首次写入：成员 {m_total} 个、角色 {c_total} 个（全量建立）"
        ));
    };
    let old: serde_json::Value = serde_json::from_str(old_text).ok()?;

    let old_m = index_map(&old, "members", "nickname");
    let new_m = index_map(&new, "members", "nickname");

    let mut add_members: Vec<String> = Vec::new();
    let mut del_members: Vec<String> = Vec::new();
    let mut add_chars: Vec<String> = Vec::new();
    let mut del_chars: Vec<String> = Vec::new();

    for (k, nm) in &new_m {
        let Some(om) = old_m.get(k) else {
            add_members.push(nick_of(nm));
            continue;
        };
        let old_c = index_map(om, "characters", "nickname");
        let new_c = index_map(nm, "characters", "nickname");
        // 角色昵称在应用内已形如“成员-职业”，直接记角色昵称即可，避免重复前缀
        for (ck, nc) in &new_c {
            if !old_c.contains_key(ck) {
                add_chars.push(nick_of(nc));
            }
        }
        for (ck, oc) in &old_c {
            if !new_c.contains_key(ck) {
                del_chars.push(nick_of(oc));
            }
        }
    }
    for (k, om) in &old_m {
        if !new_m.contains_key(k) {
            del_members.push(nick_of(om));
        }
    }

    // 模板 / 排班记录：只报数量增减，不展开详情（避免刷屏）
    let mut meta: Vec<String> = Vec::new();
    for (key, label) in [("templates", "模板"), ("schedules", "排班记录")] {
        let a = arr_of(&old, key).len();
        let b = arr_of(&new, key).len();
        let (add, del) = if b >= a { (b - a, 0) } else { (0, a - b) };
        if add > 0 || del > 0 {
            meta.push(format!("{label} +{add}/-{del}"));
        }
    }

    let mut lines = Vec::new();
    if let Some(s) = diff_label(&add_members, &del_members, "成员") {
        lines.push(s);
    }
    if let Some(s) = diff_label(&add_chars, &del_chars, "角色") {
        lines.push(s);
    }
    if !meta.is_empty() {
        lines.push(meta.join("；"));
    }
    if lines.is_empty() {
        return None;
    }
    Some(format!("DIFF 数据文件: {}", lines.join("；")))
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
        let _ = write_all(
            stream,
            format!("Content-Type: {}\r\n", content_type).as_bytes(),
        );
    }
    let _ = write_all(
        stream,
        format!("Content-Length: {}\r\n", body.len()).as_bytes(),
    );
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
    if reader
        .read_line(&mut req_line)
        .map(|n| n == 0)
        .unwrap_or(true)
    {
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
                append_log("READ  /load_data   204 无数据（文件不存在）");
                write_response(&mut stream, 204, "text/plain", b"");
                return;
            }
            match fs::read(&p) {
                Ok(data) => {
                    append_log(&format!("READ  /load_data   200 ok，读出 {} 字节", data.len()));
                    write_response(&mut stream, 200, "application/json", &data);
                }
                Err(e) => {
                    append_log(&format!("READ  /load_data   500 读取失败：{e}"));
                    write_response(
                        &mut stream,
                        500,
                        "text/plain",
                        format!("read failed: {e}").as_bytes(),
                    );
                }
            }
        }
        ("POST", "/save_data") => {
            let p = data_path();
            // 写入前旧内容（可能不存在）用于增删对比
            let old_raw = fs::read_to_string(&p).ok();
            match fs::write(&p, &body) {
                Ok(()) => {
                    append_log(&format!("WRITE /save_data   200 ok，写入 {} 字节", body.len()));
                    let new_text = String::from_utf8_lossy(&body);
                    if let Some(diff) = describe_changes(old_raw.as_deref(), &new_text) {
                        append_log(&diff);
                    }
                    write_response(&mut stream, 200, "text/plain", b"saved");
                }
                Err(e) => {
                    append_log(&format!("WRITE /save_data   500 写入失败：{e}"));
                    write_response(
                        &mut stream,
                        500,
                        "text/plain",
                        format!("write failed: {e}").as_bytes(),
                    );
                }
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
    println!("  日志文件:  {}", log_path().display());
    println!("  日志轮转:  单文件 {:.0}MB 轮转，总大小上限 {:.0}MB", LOG_ROTATE_BYTES as f64 / 1024.0 / 1024.0, LOG_TOTAL_CAP as f64 / 1024.0 / 1024.0);
    append_log(&format!("服务启动：监听 http://{addr}"));

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                thread::spawn(move || handle_client(s));
            }
            Err(_) => continue,
        }
    }
}
