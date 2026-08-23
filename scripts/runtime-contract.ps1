function Assert-SupportedWindowsAmd64 {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "This bundle requires Windows 10 or Windows 11 on AMD64."
    }

    if (-not ("CodexRuntimeNative" -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CodexRuntimeNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_INFO
    {
        public ushort wProcessorArchitecture;
        public ushort wReserved;
        public uint dwPageSize;
        public IntPtr lpMinimumApplicationAddress;
        public IntPtr lpMaximumApplicationAddress;
        public IntPtr dwActiveProcessorMask;
        public uint dwNumberOfProcessors;
        public uint dwProcessorType;
        public uint dwAllocationGranularity;
        public ushort wProcessorLevel;
        public ushort wProcessorRevision;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RTL_OSVERSIONINFOEX
    {
        public uint dwOSVersionInfoSize;
        public uint dwMajorVersion;
        public uint dwMinorVersion;
        public uint dwBuildNumber;
        public uint dwPlatformId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szCSDVersion;
        public ushort wServicePackMajor;
        public ushort wServicePackMinor;
        public ushort wSuiteMask;
        public byte wProductType;
        public byte wReserved;
    }

    [DllImport("kernel32.dll")]
    public static extern void GetNativeSystemInfo(out SYSTEM_INFO lpSystemInfo);

    [DllImport("ntdll.dll")]
    public static extern int RtlGetVersion(ref RTL_OSVERSIONINFOEX lpVersionInformation);
}
'@ -ErrorAction Stop
    }

    try {
        $osVersion = New-Object CodexRuntimeNative+RTL_OSVERSIONINFOEX
        $osVersion.dwOSVersionInfoSize = [Runtime.InteropServices.Marshal]::SizeOf($osVersion)
        if ([CodexRuntimeNative]::RtlGetVersion([ref]$osVersion) -ne 0) {
            throw "RtlGetVersion failed."
        }
        if ($osVersion.dwMajorVersion -ne 10 -or $osVersion.dwBuildNumber -lt 10240) {
            throw "This bundle requires a supported Windows 10 or Windows 11 build."
        }

        $windowsVersion = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction Stop
        if ($windowsVersion.InstallationType -ne "Client") {
            throw "This bundle requires a Windows client installation."
        }

        $systemInfo = New-Object CodexRuntimeNative+SYSTEM_INFO
        [CodexRuntimeNative]::GetNativeSystemInfo([ref]$systemInfo)
    } catch {
        throw "Unable to establish the native Windows platform: $($_.Exception.Message)"
    }

    if ($systemInfo.wProcessorArchitecture -ne 9) {
        throw "This bundle requires native AMD64 Windows."
    }
}

function ConvertTo-SingleQuotedPowerShellLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-StreamSha256 {
    param([System.IO.Stream]$Stream)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($Stream)
        return ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Get-ArchiveEntrySha256 {
    param(
        [string]$ArchivePath,
        [string]$EntryPath
    )

    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    } catch {
        if (-not ("System.IO.Compression.ZipFile" -as [type])) {
            throw "Unable to read the bundled runtime archive."
        }
    }

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -ieq $EntryPath })
        if ($entries.Count -ne 1) {
            throw "Bundled runtime archive is missing the expected node.exe entry."
        }

        $stream = $entries[0].Open()
        try {
            return Get-StreamSha256 -Stream $stream
        } finally {
            $stream.Dispose()
        }
    } finally {
        $zip.Dispose()
    }
}

function Get-VerifiedRuntime {
    param([string]$ProjectRoot)

    Assert-SupportedWindowsAmd64

    $runtimeRoot = Join-Path $ProjectRoot "runtime"
    $manifestPath = Join-Path $runtimeRoot "runtime.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Bundled runtime manifest is missing: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $archivePath = Join-Path $runtimeRoot $manifest.archive
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "Bundled runtime archive is missing: $archivePath"
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $manifest.sha256) {
        throw "Bundled Node.js checksum mismatch."
    }

    $entryPath = "$($manifest.extractedDirectory)/$($manifest.executable)"
    $entryHash = Get-ArchiveEntrySha256 -ArchivePath $archivePath -EntryPath $entryPath
    $nodePath = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $runtimeRoot "expanded") (Join-Path $manifest.extractedDirectory $manifest.executable)))

    return [pscustomobject]@{
        Manifest = $manifest
        ArchivePath = $archivePath
        NodePath = $nodePath
        NodeArchiveHash = $entryHash
    }
}

function Assert-VerifiedBundledNode {
    param(
        [psobject]$Runtime,
        [string]$NodePath
    )

    $providedNodePath = [System.IO.Path]::GetFullPath($NodePath)
    if (-not [string]::Equals($providedNodePath, $Runtime.NodePath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "NodePath does not match the expected bundled runtime path."
    }
    if (-not (Test-Path -LiteralPath $providedNodePath -PathType Leaf)) {
        throw "Bundled Node.js executable is missing: $providedNodePath"
    }

    $nodeHash = (Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($nodeHash -ne $Runtime.NodeArchiveHash) {
        throw "Bundled Node.js executable hash does not match the verified archive entry."
    }

    $version = (& $NodePath --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne $Runtime.Manifest.version) {
        throw "Bundled Node.js version mismatch: $version"
    }

    return $providedNodePath
}
