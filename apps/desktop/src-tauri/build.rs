//! Build script of the desktop shell. `tauri_build::build()` validates `tauri.conf.json` and
//! copies the external binary and the resources next to the executable; it fails with a bare
//! "path not found" when the generated inputs are missing, so this script names them first.

use std::env;
use std::path::{Path, PathBuf};

/// Generated inputs that `pnpm sidecar:bundle` and `pnpm sidecar:node` produce (apps/desktop).
fn missing_inputs(manifest_dir: &Path, target: &str) -> Vec<PathBuf> {
    let exe = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let mut expected = vec![
        manifest_dir
            .join("binaries")
            .join(format!("apex-node-{target}{exe}")),
        manifest_dir.join("../sidecar/dist/apex-mcp.cjs"),
    ];
    for folder in ["narrators", "prompts", "style", "evals"] {
        expected.push(manifest_dir.join("resources").join(folder));
    }
    expected.into_iter().filter(|p| !p.exists()).collect()
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let target = env::var("TARGET").unwrap_or_default();
    let missing = missing_inputs(&manifest_dir, &target);
    if !missing.is_empty() {
        eprintln!("Apex Galaxia: the sidecar inputs are missing:");
        for path in &missing {
            eprintln!("  {}", path.display());
        }
        eprintln!("Run `pnpm sidecar:bundle && pnpm sidecar:node` in apps/desktop first (see apps/desktop/sidecar/README.md).");
        std::process::exit(1);
    }
    tauri_build::build()
}
