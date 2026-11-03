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
        try { UserPrincipal owner;
            if(Files.getFileAttributeView(probe,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS)!=null) {
                // NTSystem reads the native process identity; neither user.name
                // nor the token's default file owner (possibly Administrators)
                // identifies the individual service user reliably.
                try {
                    var token=new com.sun.security.auth.module.NTSystem();
                    String sid=token.getUserSID(),name=token.getName(),domain=token.getDomain();
                    if(sid==null||!sid.matches("S-1-[0-9-]+")||name==null||name.isBlank())throw new IOException("WINDOWS_SERVICE_TOKEN_INVALID");
                    String account=domain==null||domain.isBlank()?name:domain+"\\"+name;
                    owner=probe.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByName(account);
                } catch(LinkageError|SecurityException unavailable) { throw new IOException("WINDOWS_SERVICE_TOKEN_UNAVAILABLE",unavailable); }
            } else owner=Files.getOwner(probe,LinkOption.NOFOLLOW_LINKS);
            if(owner instanceof GroupPrincipal)throw new IOException("INDIVIDUAL_SERVICE_OWNER_REQUIRED");
            return owner;
        }
        finally { Files.deleteIfExists(probe); }
    }
    static Path createDirectory(Path path) throws IOException {
        Files.createDirectory(path);return initializeNew(path,true);
    }
    static Path createFile(Path path) throws IOException {
        Files.createFile(path);return initializeNew(path,false);
    }
    static Path createTempFile(String prefix,String suffix) throws IOException {
        // Empty atomic temporary file; seal/verify before any private bytes.
        return initializeNew(Files.createTempFile(prefix,suffix),false);
    }
    private static Path initializeNew(Path path,boolean directory) throws IOException {
        // Called only after atomic CREATE_NEW/createDirectory succeeded. Never
        // used for existing or recovered paths, and never after content writes.
        try {
            AclFileAttributeView acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
            if(acl!=null&&!acl.getOwner().equals(owner()))acl.setOwner(owner());
            seal(path,directory);return path;
        } catch(IOException|RuntimeException failure) {
            try { Files.deleteIfExists(path); } catch(IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
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
