use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=../UPDATE_BLOCK");
    let blocked = Path::new("../UPDATE_BLOCK").exists();
    println!(
        "cargo:rustc-env=RIBBONS_UPDATE_BLOCK={}",
        if blocked { 1 } else { 0 }
    );
    tauri_build::build()
}
