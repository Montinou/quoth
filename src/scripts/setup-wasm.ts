import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PUBLIC_WASM_DIR = path.join(process.cwd(), "public", "wasm");

/**
 * Setup WASM files for tree-sitter
 *
 * This script builds compatible WASM files using tree-sitter-cli and stores them
 * in public/wasm/ for use by the AST chunker.
 */
async function setupWasm() {
  console.log("🔧 Setting up Tree-sitter WASM files...\n");

  // Ensure public/wasm directory exists
  if (!fs.existsSync(PUBLIC_WASM_DIR)) {
    fs.mkdirSync(PUBLIC_WASM_DIR, { recursive: true });
  }

  // Required WASM files
  const wasmFiles = [
    {
      name: "web-tree-sitter.wasm",
      source: path.join(process.cwd(), "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
      build: null, // Copy from node_modules
    },
    {
      name: "tree-sitter-typescript.wasm",
      source: path.join(PUBLIC_WASM_DIR, "tree-sitter-typescript.wasm"),
      build: "node_modules/tree-sitter-typescript/typescript",
    },
    {
      name: "tree-sitter-javascript.wasm",
      source: path.join(PUBLIC_WASM_DIR, "tree-sitter-javascript.wasm"),
      build: "node_modules/tree-sitter-javascript",
    },
    {
      name: "tree-sitter-python.wasm",
      source: path.join(PUBLIC_WASM_DIR, "tree-sitter-python.wasm"),
      build: "node_modules/tree-sitter-python",
    },
  ];

  console.log("📋 Checking WASM files in public/wasm/...\n");

  let allFound = true;
  for (const file of wasmFiles) {
    const destPath = path.join(PUBLIC_WASM_DIR, file.name);

    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      console.log(`  ✅ ${file.name} (${(stats.size / 1024).toFixed(1)} KB)`);
    } else if (file.build === null && fs.existsSync(file.source)) {
      // Copy from node_modules
      fs.copyFileSync(file.source, destPath);
      const stats = fs.statSync(destPath);
      console.log(`  ✅ ${file.name} (copied from node_modules, ${(stats.size / 1024).toFixed(1)} KB)`);
    } else if (file.build) {
      // Build with tree-sitter-cli
      console.log(`  ⏳ ${file.name} - building with tree-sitter-cli...`);
      try {
        execSync(`npx tree-sitter build --wasm ${file.build} -o ${destPath}`, {
          stdio: "inherit",
          timeout: 120000,
        });
        const stats = fs.statSync(destPath);
        console.log(`  ✅ ${file.name} (built, ${(stats.size / 1024).toFixed(1)} KB)`);
      } catch (error) {
        console.log(`  ❌ ${file.name} - build failed`);
        allFound = false;
      }
    } else {
      console.log(`  ❌ ${file.name} - NOT FOUND`);
      allFound = false;
    }
  }

  if (!allFound) {
    console.log("\n⚠️  Some WASM files are missing. Try running:");
    console.log("  npm install web-tree-sitter tree-sitter-cli tree-sitter-typescript tree-sitter-javascript tree-sitter-python --save-dev");
    console.log("  npm run setup:wasm");
    process.exit(1);
  }

  console.log("\n✅ WASM setup complete!\n");

  // Show usage info
  console.log("📖 Usage:");
  console.log("  - AST chunking will be automatically enabled when WASM files are found");
  console.log("  - Set DISABLE_AST_CHUNKING=true to force fallback text chunking");
  console.log("  - Run 'npm run verify:rag' to test the full RAG pipeline\n");
}

setupWasm().catch(console.error);
