package org.osgi.framework;
public final class Version {private final int major,minor,micro;public Version(int major,int minor,int micro){this.major=major;this.minor=minor;this.micro=micro;}public int getMajor(){return major;}public int getMinor(){return minor;}public int getMicro(){return micro;}@Override public String toString(){return major+"."+minor+"."+micro;}}
