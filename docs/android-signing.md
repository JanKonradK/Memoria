# Moving Android to a dedicated release key

Installed copies of Memoria are signed with the Android debug keystore. Its password is public
(`android`), the same file signs every debug build on the development PC, and a copy is a repository
secret. Anyone who obtains it can publish an update Android will install over Memoria.

Android refuses an update signed with a different key, so the switch costs every user one
reinstall. Do it while the installed base is small.

## Steps

1. **Create the key, offline.**

   ```sh
   keytool -genkeypair -v -keystore memoria-release.jks -alias memoria -keyalg RSA -keysize 4096 -validity 10000
   ```

   Use a long, unique password. Keep two offline copies of the `.jks` file and the password
   (for example a password manager and an encrypted USB stick). Losing it means no updates ever again.

2. **Ship one last release on the old key** whose release notes ask everyone to export a backup
   (**Settings → Data → Export backup**) and to install the next version by hand. Check on a phone
   that the export restores with **Merge backup** on a fresh install.

3. **Set the repository secrets** for the next release:
   - `ANDROID_KEYSTORE_BASE64`: `base64 -w0 memoria-release.jks`
   - `MEMORIA_KEY_ALIAS`: `memoria`
   - `MEMORIA_KEYSTORE_PASSWORD` and `MEMORIA_KEY_PASSWORD`

   The release workflow uses the dedicated key as soon as `MEMORIA_KEY_ALIAS` exists.
   Local builds use it with `MEMORIA_KEYSTORE=/path/to/memoria-release.jks` and the same variables.

4. **Delete the old secret value from anywhere it was copied**, and never sign a release with the
   debug keystore again.

5. After the first release on the new key, users uninstall Memoria, install the new APK and import
   their backup. Wi-Fi pairing must be redone on the phone.
