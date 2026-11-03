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
        String originalUser=System.getProperty("user.name");
        System.setProperty("user.name","workproof-spoofed-property-not-a-service-user");
        try {
            Path root=PrivateJobSpool.createDirectory(base.resolve("spool"));
            AclFileAttributeView acl=Files.getFileAttributeView(root,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
            UserPrincipal other=null;
            if(acl!=null) {
                UserPrincipal owner=Files.getOwner(root);
                other=Files.getFileAttributeView(base,AclFileAttributeView.class).getAcl().stream().map(AclEntry::principal).filter(p->!p.equals(owner)).findFirst()
                    .orElseThrow(()->new AssertionError("Windows fixture needs another real ACL principal"));
            }
            PrivateJobSpool.seal(root,true);PrivateJobSpool.verify(root,true);
            Path document=PrivateJobSpool.createTempFile("workproof-ai-private-probe-",".txt");
            try {
                if(Files.size(document)!=0)throw new AssertionError("Private input must begin empty");
                PrivateJobSpool.verify(document,false);
                Files.writeString(document,"synthetic private analysis input");PrivateJobSpool.verify(document,false);
                if(acl!=null) {
                    AclFileAttributeView view=Files.getFileAttributeView(document,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
                    List<AclEntry> changed=new ArrayList<>(view.getAcl());
                    changed.add(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(other)
                        .setPermissions(AclEntryPermission.READ_DATA).build());view.setAcl(changed);
                } else Files.setPosixFilePermissions(document,PosixFilePermissions.fromString("rw-r-----"));
                reject(()->PrivateJobSpool.verify(document,false));
                System.out.println("PASS private temporary analysis input: empty before sealed write, additional reader refused");
            } finally { Files.deleteIfExists(document); }
            Path lock=PrivateJobSpool.createFile(root.resolve(".queue.lock"));
            Path proof=PrivateJobSpool.createFile(root.resolve("test.proof"));
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
                UserPrincipal serviceOwner=Files.getOwner(root),defaultOwner=Files.getOwner(base);
                if(!serviceOwner.equals(defaultOwner)) {
                    try {
                        Files.setOwner(proof,defaultOwner);
                        reject(()->PrivateJobSpool.verify(proof,false));
                        reject(()->PrivateJobSpool.seal(proof,false));
                        System.out.println("PASS Windows existing other-owner proof rejected without takeover");
                    } catch(FileSystemException denied) { System.out.println("UNMEASURED other-owner mutation not permitted"); }
                    finally { Files.setOwner(proof,serviceOwner); }
                }
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
            if(originalUser==null)System.clearProperty("user.name");else System.setProperty("user.name",originalUser);
            try(var entries=Files.walk(base)) { for(Path path:entries.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path); }
        }
    }
}
