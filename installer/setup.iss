[Setup]
AppName=Chitrakatha Agent
AppVersion=1.0.0
DefaultDirName={pf}\Chitrakatha
DefaultGroupName=Chitrakatha
OutputDir=dist
OutputBaseFilename=chitrakatha_agent
PrivilegesRequired=admin
Compression=lzma
SolidCompression=yes

[Files]
Source: "build\chitrakatha_agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Chitrakatha Agent"; Filename: "{app}\chitrakatha_agent.exe"
Name: "{commondesktop}\Chitrakatha Agent"; Filename: "{app}\chitrakatha_agent.exe"

[Run]
Filename: "netsh";
Parameters: "advfirewall firewall add rule name=""Chitrakatha Agent"" dir=in action=allow program=""{app}\chitrakatha_agent.exe"" enable=yes";
Flags: runhidden

[UninstallRun]
Filename: "netsh";
Parameters: "advfirewall firewall delete rule name=""Chitrakatha Agent""";
Flags: runhidden
