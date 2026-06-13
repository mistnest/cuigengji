Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\novel\novel-ai-editor"
WshShell.Run "cmd /c npm run start:electron", 0, False
