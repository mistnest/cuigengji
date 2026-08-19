# Sandboxed preload sources

Electron 继续加载单一 electron/preload.cjs。本目录是 P2 的可维护源码目标；在 bundling spike 完成前不会被运行时加载，也不得通过 sandbox preload 的本地 require 直接拼装。
