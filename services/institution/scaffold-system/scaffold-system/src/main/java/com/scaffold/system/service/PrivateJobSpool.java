package com.scaffold.system.service;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.*;

/** Private input storage; unsupported permission providers fail closed. */
final class PrivateJobSpool {
    private PrivateJobSpool() {}
    private static UserPrincipal serviceOwner() throws IOException {
        // Read the owner assigned by the filesystem to a file created by this
        // process, rather than trusting user.name or a caller supplied owner.
        Path probe=Files.createTempFile("workproof-owner-", ".probe");
        try { UserPrincipal owner=Files.getOwner(probe,LinkOption.NOFOLLOW_LINKS);
            if(owner instanceof GroupPrincipal)throw new IOException("INDIVIDUAL_SERVICE_OWNER_REQUIRED");
            return owner;
        }
        finally { Files.deleteIfExists(probe); }
    }
    private static final class Identity {
        static final UserPrincipal OWNER;
        static final IOException ERROR;
        static { UserPrincipal owner=null; IOException error=null;
            try { owner=serviceOwner(); } catch(IOException e) { error=e; }
            OWNER=owner; ERROR=error;
        }
    }
    private static UserPrincipal owner() throws IOException {
        if(Identity.ERROR!=null)throw new IOException("SERVICE_OWNER_UNAVAILABLE",Identity.ERROR);
        return Identity.OWNER;
    }
    static void seal(Path path,boolean directory) throws IOException {
        if(Files.isSymbolicLink(path))throw new IOException("SPOOL_LINK_REJECTED");
        if(!Files.getOwner(path,LinkOption.NOFOLLOW_LINKS).equals(owner()))throw new IOException("SPOOL_OWNER_MISMATCH");
        PosixFileAttributeView posix=Files.getFileAttributeView(path,PosixFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(posix!=null) {
            posix.setPermissions(PosixFilePermissions.fromString(directory?"rwx------":"rw-------"));
        } else {
            AclFileAttributeView acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
            if(acl==null)throw new IOException("PRIVATE_SPOOL_PERMISSIONS_UNSUPPORTED");
            // No inheritable ACE: files are sealed before any content is written.
            acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(owner())
                .setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
        }
        verify(path,directory);
    }
    static void verify(Path path,boolean directory) throws IOException {
        if(Files.isSymbolicLink(path)||!Files.getOwner(path,LinkOption.NOFOLLOW_LINKS).equals(owner()))throw new IOException("SPOOL_OWNER_OR_LINK_INVALID");
        PosixFileAttributeView posix=Files.getFileAttributeView(path,PosixFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(posix!=null) {
            if(!posix.readAttributes().permissions().equals(PosixFilePermissions.fromString(directory?"rwx------":"rw-------")))throw new IOException("SPOOL_PERMISSIONS_CHANGED");
            return;
        }
        AclFileAttributeView acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(acl==null)throw new IOException("PRIVATE_SPOOL_PERMISSIONS_UNSUPPORTED");
        boolean granted=false;
        for(AclEntry entry:acl.getAcl()) {
            if(entry.type()==AclEntryType.ALLOW) {
                if(!entry.principal().equals(owner()))throw new IOException("SPOOL_OTHER_PRINCIPAL_ALLOWED");
                granted|=entry.permissions().containsAll(EnumSet.allOf(AclEntryPermission.class));
            }
        }
        if(!granted)throw new IOException("SPOOL_SERVICE_ACCESS_MISSING");
    }
}
