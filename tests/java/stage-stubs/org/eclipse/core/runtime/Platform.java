package org.eclipse.core.runtime;
public class Platform {
    public static org.osgi.framework.Bundle getBundle(String id){return null;}
    public static Location getInstanceLocation(){return new Location();}
    public static final class Location {public java.net.URL getURL(){try{return java.nio.file.Path.of(System.getProperty("java.io.tmpdir")).toUri().toURL();}catch(Exception e){throw new IllegalStateException(e);}}}
}
