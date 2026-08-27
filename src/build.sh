#!/bin/bash
# 分割ソース(b3/)を連結してリポジトリ直下の index.html を作り、JS構文を検査する。
#
#   使い方:  bash src/build.sh     （リポジトリのどこから実行してもOK）
#
# index.html は GitHub Pages がそのまま配信するファイルです。
# index.html を直接編集しないでください。次回のビルドで上書きされます。
set -e
cd "$(dirname "$0")"
OUT="../index.html"

cat b3/p1_head.html b3/p2_body.html b3/p3_core.js b3/p4_ingest.js \
    b3/p5_logic.js b3/p6_ui1.js b3/p6b_ui2.js b3/p7_ui3.js > "$OUT"

node -e "
const fs=require('fs');
const m=fs.readFileSync('$OUT','utf8').match(/<script>([\s\S]*)<\/script>/);
try{ new Function(m[1]); console.log('JS OK'); }
catch(e){ console.log('ERR', e.message); process.exit(1); }
"
ls -la "$OUT"
