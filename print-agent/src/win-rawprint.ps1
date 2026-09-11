<#
  Hand a file of raw bytes to a Windows printer as a RAW-datatype spool job.

  This is the whole reason the agent needs no native module. An ESC/POS byte
  stream is not a document the print driver should lay out — it is already the
  language the printer speaks — and "RAW" is precisely the Windows datatype that
  says "pass these bytes through untouched". Anything that renders (Out-Printer,
  the shell's Print verb) would hand the printer a bitmap of the escape codes.

  It also means a USB thermal printer does NOT have to be shared to be printable,
  which the `copy /b \\localhost\share` trick would have required.

  Called by src/transports.mjs. Not intended to be run by hand.
#>
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$DocName = 'Mountain Bakes receipt'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class MBRawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void Send(string printerName, string filePath, string docName) {
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr handle;

        if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) {
            throw new Exception("PRINTER_NOT_FOUND:" + Marshal.GetLastWin32Error());
        }

        try {
            DOCINFO info = new DOCINFO();
            info.pDocName = docName;
            info.pDataType = "RAW";

            if (!StartDocPrinter(handle, 1, info)) {
                throw new Exception("SPOOL_REJECTED:" + Marshal.GetLastWin32Error());
            }
            try {
                if (!StartPagePrinter(handle)) {
                    throw new Exception("SPOOL_REJECTED:" + Marshal.GetLastWin32Error());
                }

                IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, buffer, bytes.Length);
                    int written = 0;
                    if (!WritePrinter(handle, buffer, bytes.Length, out written)) {
                        throw new Exception("WRITE_FAILED:" + Marshal.GetLastWin32Error());
                    }
                    // A short write means the spooler took part of the receipt and
                    // stopped. Reporting success there would print half a total.
                    if (written != bytes.Length) {
                        throw new Exception("WRITE_TRUNCATED:" + written + "/" + bytes.Length);
                    }
                } finally {
                    Marshal.FreeCoTaskMem(buffer);
                }

                EndPagePrinter(handle);
            } finally {
                EndDocPrinter(handle);
            }
        } finally {
            ClosePrinter(handle);
        }
    }
}
"@

[MBRawPrint]::Send($Printer, $Path, $DocName)
Write-Output 'OK'
