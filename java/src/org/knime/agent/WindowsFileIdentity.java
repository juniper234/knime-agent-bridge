package org.knime.agent;

import java.io.IOException;
import java.nio.file.Path;
import java.util.HexFormat;
import com.sun.jna.platform.win32.Kernel32;
import com.sun.jna.platform.win32.WinBase;
import com.sun.jna.platform.win32.WinDef;
import com.sun.jna.platform.win32.WinNT;

/**
 * Windows file identity through Kernel32. Kept in its own class so JNA is only
 * linked when this class is loaded, which happens on Windows only. The JNA
 * imports are optional in the manifest.
 */
final class WindowsFileIdentity {
    private WindowsFileIdentity(){}

    static boolean applies(){return System.getProperty("os.name","").startsWith("Windows");}

    /** Volume serial and 128-bit file ID, read without following a final reparse point. */
    static String key(Path file)throws IOException {
        // Installed JDK Windows BasicFileAttributes has null fileKey. Read the volume and
        // 128-bit file ID from an OS handle instead, without following a final reparse point.
        Kernel32 kernel=Kernel32.INSTANCE;
        WinNT.HANDLE handle=kernel.CreateFile(file.toString(),0,WinNT.FILE_SHARE_READ|WinNT.FILE_SHARE_WRITE|WinNT.FILE_SHARE_DELETE,null,WinNT.OPEN_EXISTING,WinNT.FILE_FLAG_BACKUP_SEMANTICS|WinNT.FILE_FLAG_OPEN_REPARSE_POINT,null);
        if(WinBase.INVALID_HANDLE_VALUE.equals(handle))throw new IOException("Cannot pin native export file identity; Windows error "+kernel.GetLastError());
        try{
            WinBase.FILE_ID_INFO info=new WinBase.FILE_ID_INFO();
            if(!kernel.GetFileInformationByHandleEx(handle,WinBase.FileIdInfo,info.getPointer(),new WinDef.DWORD(info.size())))throw new IOException("Cannot read native export file identity; Windows error "+kernel.GetLastError());
            info.read();return Long.toUnsignedString(info.VolumeSerialNumber,16)+":"+HexFormat.of().formatHex(info.getPointer().getByteArray(8,16));
        }finally{kernel.CloseHandle(handle);}
    }
}
