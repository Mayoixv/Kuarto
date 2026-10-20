# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Kuarto: los plugins de Capacitor se llaman por nombre desde la parte web y algunos usan reflexión o JNI
# (SQLCipher). Se conservan enteros: su código ya es público, así que ofuscarlo no aporta y romperlo sí cuesta.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.aparajita.capacitor.** { *; }
-keep class io.capawesome.capacitorjs.plugins.** { *; }
-keep class net.zetetic.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
# El plugin de Firebase trae inicio de sesión con Facebook, que Kuarto no usa ni incluye.
-dontwarn com.facebook.**
