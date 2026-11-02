package com.scaffold.system.service;

import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.*;

class PrivateJobSpoolTest {
    @TempDir Path temporary;
    @Test void emptyDirectoryIsSealedBeforeWritingAndCheckedOnRecovery() throws Exception {
        Path root=PrivateJobSpool.createDirectory(temporary.resolve("private"));
        PrivateJobSpool.seal(root,true);PrivateJobSpool.verify(root,true);
        Path input=PrivateJobSpool.createFile(root.resolve("sample.proof"));
        PrivateJobSpool.seal(input,false);Files.writeString(input,"synthetic evidence");
        PrivateJobSpool.verify(input,false);assertEquals("synthetic evidence",Files.readString(input));
    }
    @Test void windowsAdditionalReaderFailsClosed() throws Exception {
        Path root=PrivateJobSpool.createDirectory(temporary.resolve("acl"));
        AclFileAttributeView view=Files.getFileAttributeView(root,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        assumeTrue(view!=null,"Requires Windows ACL provider");
        UserPrincipal owner=Files.getOwner(root);
        UserPrincipal everyone=Files.getFileAttributeView(temporary,AclFileAttributeView.class).getAcl().stream().map(AclEntry::principal).filter(p->!p.equals(owner)).findFirst().orElseThrow();
        PrivateJobSpool.seal(root,true);
        List<AclEntry> entries=new ArrayList<>(view.getAcl());
        entries.add(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(everyone)
            .setPermissions(AclEntryPermission.READ_DATA).setFlags(AclEntryFlag.FILE_INHERIT,AclEntryFlag.DIRECTORY_INHERIT).build());
        view.setAcl(entries);
        assertThrows(java.io.IOException.class,()->PrivateJobSpool.verify(root,true));
    }
    @Test void posixOtherReaderFailsClosed() throws Exception {
        Path root=Files.createDirectory(temporary.resolve("posix"));
        assumeTrue(Files.getFileAttributeView(root,PosixFileAttributeView.class)!=null);
        PrivateJobSpool.seal(root,true);
        Files.setPosixFilePermissions(root,PosixFilePermissions.fromString("rwxr-x---"));
        assertThrows(java.io.IOException.class,()->PrivateJobSpool.verify(root,true));
    }
}
