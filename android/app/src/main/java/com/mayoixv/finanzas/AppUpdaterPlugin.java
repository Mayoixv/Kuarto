package com.mayoixv.finanzas;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;

/**
 * Actualiza la app desde los Releases de GitHub: descarga el APK y abre el instalador de Android.
 * Android solo acepta la actualización si viene firmada con la misma llave, así que un APK ajeno no se instala.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** Solo GitHub: la página del Release y los servidores a los que redirige para bajar el archivo. */
    private static final List<String> HOSTS = Arrays.asList("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com");
    /** El APK pesa unos 15 MB; esto solo evita que una respuesta enorme llene el teléfono. */
    private static final long MAX_BYTES = 150L * 1024 * 1024;

    /** La versión de depuración (la del teléfono del desarrollador) tiene otra firma: no puede instalar los Releases. */
    @PluginMethod
    public void info(PluginCall call) {
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        JSObject ret = new JSObject();
        ret.put("canUpdate", !debuggable);
        call.resolve(ret);
    }

    /**
     * Si Android aún no deja que Kuarto instale apps, abre ese permiso y devuelve needsPermission (el usuario vuelve y
     * toca Actualizar otra vez). Si ya puede, descarga el APK y abre el instalador.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (!allowed(url)) {
            call.reject("Dirección de descarga inválida");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        // En su propio hilo: los demás plugins (como la base de datos) no esperan a que termine la descarga.
        new Thread(() -> {
            File apk = new File(new File(getContext().getCacheDir(), "updates"), "kuarto.apk");
            try {
                //noinspection ResultOfMethodCallIgnored
                apk.getParentFile().mkdirs();
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);
                JSObject ret = new JSObject();
                ret.put("needsPermission", false);
                call.resolve(ret);
            } catch (Exception e) {
                // Que no quede un APK a medias.
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                call.reject("No se pudo descargar la actualización", e);
            }
        }).start();
    }

    /** https y un host de GitHub exacto (no basta con que la dirección empiece o contenga "github.com"). */
    private static boolean allowed(String address) {
        try {
            URL u = new URL(address);
            return "https".equals(u.getProtocol()) && HOSTS.contains(u.getHost().toLowerCase());
        } catch (Exception e) {
            return false;
        }
    }

    /** Sigue las redirecciones de GitHub hacia su servidor de archivos, solo dentro de GitHub y con tope de tamaño. */
    private static void download(String address, File to) throws Exception {
        String current = address;
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                current = conn.getHeaderField("Location");
                conn.disconnect();
                if (current == null || !allowed(current)) throw new Exception("Redirección inválida");
                continue;
            }
            if (code != 200) throw new Exception("HTTP " + code);
            if (conn.getContentLengthLong() > MAX_BYTES) {
                conn.disconnect();
                throw new Exception("Archivo demasiado grande");
            }
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("Archivo demasiado grande");
                    out.write(buf, 0, n);
                }
            } finally {
                conn.disconnect();
            }
            return;
        }
        throw new Exception("Demasiadas redirecciones");
    }
}
