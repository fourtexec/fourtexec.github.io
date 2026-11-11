# NewTeller

NewTeller is a complete Wayland desktop for Linux: a small wlroots compositor
plus a Qt/QML shell with a panel, a dock, a start menu, quick settings,
notifications and its own settings application.

## Get it

Builds for **Debian 13**, **Ubuntu 26.04**, **Arch Linux** and **Fedora** are
on the [download page](https://fourtexec.site/newteller/).

```
unzip newteller-commit-*.zip
cd newteller-commit-*/
sudo bash install.sh
```

Log out and choose **NewTeller** at the login screen.

## Updates

After the first installation NewTeller updates itself: **Settings → Updates**
asks this site which build is the newest, downloads it from the link it
gets, checks the SHA-256 and installs it. `newteller --install-update` does
the same from a terminal, and `sudo newteller-update-install --rollback`
returns to the build before the last update.

Source code and issues: [github.com/fourtexec/newteller](https://github.com/fourtexec/newteller).
