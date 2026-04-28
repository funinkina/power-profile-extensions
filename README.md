# Power Profile Extensions

Power Profile Extensions is a GNOME Shell extension that enables or disables other extensions based on the active power profile.

It watches `org.freedesktop.UPower.PowerProfiles.ActiveProfile` over D-Bus, so profile changes are handled as events instead of polling.

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
