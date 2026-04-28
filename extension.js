import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const POWER_BUS_NAME = 'org.freedesktop.UPower.PowerProfiles';
const POWER_OBJECT_PATH = '/org/freedesktop/UPower/PowerProfiles';
const POWER_INTERFACE = 'org.freedesktop.UPower.PowerProfiles';

const SHELL_EXTENSIONS_BUS_NAME = 'org.gnome.Shell.Extensions';
const SHELL_EXTENSIONS_OBJECT_PATH = '/org/gnome/Shell/Extensions';
const SHELL_EXTENSIONS_INTERFACE = 'org.gnome.Shell.Extensions';

const PROFILE_IDS = new Set(['power-saver', 'balanced', 'performance']);

const EXTENSION_STATE = {
    ERROR: 3,
    OUT_OF_DATE: 4,
    DOWNLOADING: 5,
    UNINSTALLED: 99,
};

export default class PowerExtensionManager extends Extension {
    enable() {
        this._enabled = true;
        this._activeProfile = null;
        this._applySerial = 0;
        this._cancellable = new Gio.Cancellable();

        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect(
            'changed::profile-rules',
            () => this._applyForCurrentProfile('settings changed'));

        this._connectShellExtensionsProxy();
        this._watchPowerProfiles();
    }

    disable() {
        this._enabled = false;
        this._applySerial++;

        this._cancellable?.cancel();
        this._cancellable = null;

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._settings = null;

        if (this._powerPropertiesChangedId) {
            this._powerProxy?.disconnect(this._powerPropertiesChangedId);
            this._powerPropertiesChangedId = null;
        }
        this._powerProxy = null;

        if (this._powerWatchId) {
            Gio.bus_unwatch_name(this._powerWatchId);
            this._powerWatchId = 0;
        }

        this._shellProxy = null;
        this._activeProfile = null;
    }

    _connectShellExtensionsProxy() {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            SHELL_EXTENSIONS_BUS_NAME,
            SHELL_EXTENSIONS_OBJECT_PATH,
            SHELL_EXTENSIONS_INTERFACE,
            this._cancellable,
            (source, result) => {
                if (!this._enabled)
                    return;

                try {
                    this._shellProxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._applyForCurrentProfile('extensions proxy ready');
                } catch (error) {
                    if (!this._isCancelled(error))
                        console.warn(`${this.metadata.name}: Failed to connect to GNOME Shell Extensions D-Bus: ${error.message}`);
                }
            });
    }

    _watchPowerProfiles() {
        this._powerWatchId = Gio.bus_watch_name(
            Gio.BusType.SYSTEM,
            POWER_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            (connection, name) => this._onPowerProfilesAppeared(connection, name),
            () => this._onPowerProfilesVanished());
    }

    _onPowerProfilesAppeared(connection, name) {
        Gio.DBusProxy.new(
            connection,
            Gio.DBusProxyFlags.NONE,
            null,
            name,
            POWER_OBJECT_PATH,
            POWER_INTERFACE,
            this._cancellable,
            (source, result) => {
                if (!this._enabled)
                    return;

                try {
                    this._powerProxy = Gio.DBusProxy.new_finish(result);
                    this._powerPropertiesChangedId = this._powerProxy.connect(
                        'g-properties-changed',
                        (proxy, changedProperties, invalidatedProperties) => {
                            const activeProfile = changedProperties.lookup_value('ActiveProfile', null);

                            if (activeProfile) {
                                this._setActiveProfile(activeProfile.deep_unpack());
                            } else if (invalidatedProperties.includes('ActiveProfile')) {
                                this._readCachedActiveProfile();
                            }
                        });
                    this._readCachedActiveProfile();
                } catch (error) {
                    if (!this._isCancelled(error))
                        console.warn(`${this.metadata.name}: Failed to connect to power-profiles-daemon: ${error.message}`);
                }
            });
    }

    _onPowerProfilesVanished() {
        if (this._powerPropertiesChangedId) {
            this._powerProxy?.disconnect(this._powerPropertiesChangedId);
            this._powerPropertiesChangedId = null;
        }

        this._powerProxy = null;
        this._activeProfile = null;
        console.warn(`${this.metadata.name}: power-profiles-daemon is not available`);
    }

    _readCachedActiveProfile() {
        const activeProfile = this._powerProxy?.get_cached_property('ActiveProfile');

        if (activeProfile)
            this._setActiveProfile(activeProfile.deep_unpack());
    }

    _setActiveProfile(profile) {
        if (!PROFILE_IDS.has(profile)) {
            console.warn(`${this.metadata.name}: Ignoring unknown power profile "${profile}"`);
            return;
        }

        if (profile === this._activeProfile)
            return;

        this._activeProfile = profile;
        this._applyForCurrentProfile(`profile changed to ${profile}`);
    }

    _applyForCurrentProfile(reason) {
        if (!this._enabled || !this._settings || !this._shellProxy || !this._activeProfile)
            return;

        const serial = ++this._applySerial;
        const profile = this._activeProfile;
        const rules = this._getProfileRules();

        if (Object.keys(rules).length === 0)
            return;

        this._listInstalledExtensions((extensions) => {
            if (!this._enabled || serial !== this._applySerial)
                return;

            for (const [uuid, enabledProfiles] of Object.entries(rules)) {
                if (uuid === this.uuid || !Array.isArray(enabledProfiles))
                    continue;

                const extensionInfo = extensions[uuid];
                if (!this._canManageExtension(uuid, extensionInfo))
                    continue;

                const shouldEnable = enabledProfiles.includes(profile);
                this._setExtensionEnabled(uuid, shouldEnable, reason);
            }
        });
    }

    _getProfileRules() {
        try {
            return this._settings.get_value('profile-rules').deep_unpack();
        } catch (error) {
            console.warn(`${this.metadata.name}: Failed to read profile rules: ${error.message}`);
            return {};
        }
    }

    _listInstalledExtensions(callback) {
        this._shellProxy.call(
            'ListExtensions',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (proxy, result) => {
                if (!this._enabled)
                    return;

                try {
                    const [extensions] = proxy.call_finish(result).deep_unpack();
                    callback(this._unpackExtensionMap(extensions));
                } catch (error) {
                    if (!this._isCancelled(error))
                        console.warn(`${this.metadata.name}: Failed to list GNOME Shell extensions: ${error.message}`);
                }
            });
    }

    _unpackExtensionMap(extensions) {
        const unpacked = {};

        for (const [uuid, info] of Object.entries(extensions)) {
            unpacked[uuid] = {};

            for (const [key, value] of Object.entries(info))
                unpacked[uuid][key] = value instanceof GLib.Variant ? value.deep_unpack() : value;
        }

        return unpacked;
    }

    _canManageExtension(uuid, extensionInfo) {
        if (!extensionInfo)
            return false;

        const state = Number(extensionInfo.state);

        if (state === EXTENSION_STATE.ERROR ||
            state === EXTENSION_STATE.OUT_OF_DATE ||
            state === EXTENSION_STATE.DOWNLOADING ||
            state === EXTENSION_STATE.UNINSTALLED) {
            console.warn(`${this.metadata.name}: Skipping ${uuid}; current state is ${state}`);
            return false;
        }

        return true;
    }

    _setExtensionEnabled(uuid, enabled, reason) {
        const method = enabled ? 'EnableExtension' : 'DisableExtension';

        this._shellProxy.call(
            method,
            new GLib.Variant('(s)', [uuid]),
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (proxy, result) => {
                if (!this._enabled)
                    return;

                try {
                    const [success] = proxy.call_finish(result).deep_unpack();

                    if (!success)
                        console.warn(`${this.metadata.name}: ${method} returned false for ${uuid} (${reason})`);
                } catch (error) {
                    if (!this._isCancelled(error))
                        console.warn(`${this.metadata.name}: Failed to ${enabled ? 'enable' : 'disable'} ${uuid}: ${error.message}`);
                }
            });
    }

    _isCancelled(error) {
        return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
    }
}
