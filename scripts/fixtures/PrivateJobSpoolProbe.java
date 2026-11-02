package com.scaffold.system.service;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.*;

/** Native-filesystem CI probe; no database, Spring or service credentials. */
public final class PrivateJobSpoolProbe {
    interface Action { void run() throws Exception; }
    static void reject(Action action) throws Exception {
        try { action.run(); } catch(IOException expected) { return; }
        throw new AssertionError("Expected permission/link rejection");
    }
    public static void main(String[] args) throws Exception {
        Path base=Files.createTempDirectory("workproof-spool-probe-");
        try {
            Path root=Files.createDirectory(base.resolve("spool"));
            AclFileAttributeView acl=Files.getFileAttributeView(root,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
            UserPrincipal other=null;
            if(acl!=null) {
                UserPrincipal owner=Files.getOwner(root);
                other=acl.getAcl().stream().map(AclEntry::principal).filter(p->!p.equals(owner)).findFirst()
                    .orElseThrow(()->new AssertionError("Windows fixture needs another real ACL principal"));
            }
            PrivateJobSpool.seal(root,true);PrivateJobSpool.verify(root,true);
            Path lock=Files.createFile(root.resolve(".queue.lock"));PrivateJobSpool.seal(lock,false);
            Path proof=Files.createFile(root.resolve("test.proof"));PrivateJobSpool.seal(proof,false);
            Files.writeString(proof,"synthetic certificate");PrivateJobSpool.verify(proof,false);
            PrivateJobSpool.verify(lock,false);
            if(acl!=null) {
                for(Path path:List.of(root,proof,lock)) {
                    AclFileAttributeView view=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
                    List<AclEntry> original=view.getAcl(),changed=new ArrayList<>(original);
                    var builder=AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(other).setPermissions(AclEntryPermission.READ_DATA);
                    if(path.equals(root))builder.setFlags(AclEntryFlag.FILE_INHERIT,AclEntryFlag.DIRECTORY_INHERIT);
                    changed.add(builder.build());view.setAcl(changed);
                    reject(()->PrivateJobSpool.verify(path,path.equals(root)));view.setAcl(original);
                }
                System.out.println("PASS Windows real ACL: exclusive owner, inherited other-principal grants rejected for directory, lock and recovered proof");
            } else {
                for(Path path:List.of(root,proof,lock)) {
                    Files.setPosixFilePermissions(path,PosixFilePermissions.fromString(path.equals(root)?"rwxr-x---":"rw-r-----"));
                    reject(()->PrivateJobSpool.verify(path,path.equals(root)));PrivateJobSpool.seal(path,path.equals(root));
                }
                System.out.println("PASS POSIX private directory, lock and recovered proof; additional readers rejected");
            }
            Path link=base.resolve("link");
            try { Files.createSymbolicLink(link,proof);reject(()->PrivateJobSpool.verify(link,false));reject(()->PrivateJobSpool.seal(link,false)); }
            catch(UnsupportedOperationException|FileSystemException unavailable) { System.out.println("UNMEASURED symbolic-link creation unavailable: "+unavailable.getClass().getSimpleName()); }
            System.out.println("SCOPE filesystem privacy only; Windows full queue lifecycle and other-owner mutation still require integration acceptance");
        } finally {
            try(var entries=Files.walk(base)) { for(Path path:entries.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path); }
        }
    }
}
