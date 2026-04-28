<h1>
  <img src="icon.png" width=36 alt="Power Profile Extensions icon">
  Power Profile Extensions
</h1>

Power Profile Extensions is a GNOME Shell extension that enables or disables other extensions based on the active power profile.

It watches `org.freedesktop.UPower.PowerProfiles.ActiveProfile` over D-Bus, so profile changes are handled automatically.

<p>
Coming Soon on Gnome Extension....
<a href="https://extensions.gnome.org/extension/9791/power-profile-extensions/">
    <img src="https://github.com/andyholmes/gnome-shell-extensions-badge/raw/master/get-it-on-ego.png" width=180 alt="Get it on GNOME Extensions" />
</a>
</p>

<p>
    <img src="https://img.shields.io/gnome-extensions/dt/power-profile-extensions%40funinkina.co.in?color=57a8ff" alt="Extension Downloads" />
    <img src="https://img.shields.io/badge/GNOME%20Shell-46%20|%2047%20|%2048|%2049|%2050-blue" alt="GNOME Shell Version" />
    <img src="https://img.shields.io/github/stars/funinkina/power-profile-extensions" alt="GitHub stars" />
    <br>
    <img src="https://img.shields.io/github/license/funinkina/power-profile-extensions" alt="License" />
    <img src="https://img.shields.io/github/issues/funinkina/power-profile-extensions" alt="GitHub issues" />
    <img src="https://img.shields.io/github/last-commit/funinkina/power-profile-extensions" alt="Last commit" />
</p>

## Preferences UI

<img width="650" alt="screenshot" src="https://github.com/user-attachments/assets/490ce606-a14f-42ab-95b4-633d841f1ef7" />


## Build

```sh
make pack
```

## Install locally

```sh
make install
gnome-extensions enable power-profile-extensions@funinkina.co.in
gnome-extensions prefs power-profile-extensions@funinkina.co.in
```

You may need to log out and back in, or restart GNOME Shell on X11, after installing a local extension for the first time.

## Behavior

In preferences, turn on management for an extension and choose the profiles where it should be enabled:

- Power Saver
- Balanced
- Performance

Unmanaged extensions are left untouched. If a managed extension has no profiles checked, it will be disabled for every power profile.

When Power Profile Extensions itself is disabled, it disconnects its D-Bus watchers and leaves the last applied extension states as-is.
