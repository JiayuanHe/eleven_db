#!/usr/bin/env node
/**
 * Eleven DB — CLI 占位入口。
 *
 * V0.1：仅占位，未来 V1+ 在此实现 `eleven conn list` `eleven sql -c <id> "..."` 等。
 * 当前 `npx eleven` 会输出此帮助。
 */

console.log(`
Eleven DB CLI — V0.1 占位实现

预留接口（V1 阶段实现）：
  eleven conn list
  eleven conn test <id>
  eleven sql -c <id> "<sql>"
  eleven export -c <id> -t <table> -o file.csv
`);
