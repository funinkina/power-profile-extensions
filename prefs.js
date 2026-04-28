import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {
    EXTENSION_STATE,
    SHELL_EXTENSIONS_BUS_NAME,
    SHELL_EXTENSIONS_INTERFACE,
    SHELL_EXTENSIONS_OBJECT_PATH,
    isCancelled,
} from './utils.js';

const PROFILE_DEFINITIONS = [
    {id: 'power-saver', get title() { return _('Power Saver'); }},
    {id: 'balanced', get title() { return _('Balanced'); }},
    {id: 'performance', get title() { return _('Performance'); }},
];

function unpackVariant(value) {
    return value instanceof GLib.Variant ? value.deep_unpack() : value;
}

function getProfileRules(settings) {
    return settings.get_value('profile-rules').deep_unpack();
}

function setProfileRules(settings, rules) {
    settings.set_value('profile-rules', new GLib.Variant('a{sas}', rules));
}

class ExtensionRuleRow extends Adw.ExpanderRow {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, extensionInfo) {
        const uuid = extensionInfo.uuid;
        const name = extensionInfo.name || uuid;

        super({
            title: name,
            subtitle: uuid,
        });

        this._settings = settings;
        this._uuid = uuid;
        this._searchText = `${name} ${uuid}`.toLowerCase();
        this._syncing = false;
        this._profileSwitches = new Map();
        this._profileRows = [];

        this._manageSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Manage this extension'),
        });
        this.add_suffix(this._manageSwitch);

        this._manageSwitch.connect('notify::active', () => {
            if (this._syncing)
                return;

            this._setManaged(this._manageSwitch.active);
        });

        for (const profile of PROFILE_DEFINITIONS)
            this._addProfileRow(profile);

        this._settingsChangedId = this._settings.connect(
            'changed::profile-rules',
            () => this._syncFromSettings());

        this.connect('destroy', () => {
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
        });

        this._syncFromSettings();
    }

    matches(query) {
        return this._searchText.includes(query);
    }

    _addProfileRow(profile) {
        const profileSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            tooltip_text: `${_('Enable in')} ${profile.title}`,
        });
        profileSwitch.connect('notify::active', () => {
            if (this._syncing)
                return;

            this._setProfileEnabled(profile.id, profileSwitch.active);
        });

        const row = new Adw.ActionRow({
            title: profile.title,
            activatable_widget: profileSwitch,
        });
        row.add_suffix(profileSwitch);
        this.add_row(row);

        this._profileRows.push(row);
        this._profileSwitches.set(profile.id, profileSwitch);
    }

    _syncFromSettings() {
        const rules = getProfileRules(this._settings);
        const managed = Object.prototype.hasOwnProperty.call(rules, this._uuid);
        const enabledProfiles = managed ? rules[this._uuid] : [];

        this._syncing = true;
        this._manageSwitch.active = managed;
        this.subtitle = managed ? this._uuid : `${this._uuid} - ${_('not managed')}`;
        this.expanded = managed;

        for (const profile of PROFILE_DEFINITIONS) {
            const profileSwitch = this._profileSwitches.get(profile.id);
            profileSwitch.active = enabledProfiles.includes(profile.id);
            profileSwitch.sensitive = managed;
        }

        for (const row of this._profileRows)
            row.sensitive = managed;

        this._syncing = false;
    }

    _setManaged(managed) {
        const rules = getProfileRules(this._settings);

        if (managed)
            rules[this._uuid] = PROFILE_DEFINITIONS.map(profile => profile.id);
        else
            delete rules[this._uuid];

        setProfileRules(this._settings, rules);
    }

    _setProfileEnabled(profileId, enabled) {
        const rules = getProfileRules(this._settings);
        const enabledProfiles = new Set(rules[this._uuid] ?? []);

        if (enabled)
            enabledProfiles.add(profileId);
        else
            enabledProfiles.delete(profileId);

        rules[this._uuid] = PROFILE_DEFINITIONS
            .map(profile => profile.id)
            .filter(profile => enabledProfiles.has(profile));

        setProfileRules(this._settings, rules);
    }
}

class PowerExtensionManagerPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, selfUuid) {
        super({
            title: _('Power Extension Manager'),
            icon_name: 'preferences-system-symbolic',
        });

        this._settings = settings;
        this._selfUuid = selfUuid;
        this._rows = [];
        this._cancellable = new Gio.Cancellable();

        this._buildControls();
        this._buildExtensionsGroup();
        this._connectShellExtensionsProxy();

        this.connect('destroy', () => this._cancellable.cancel());
    }

    _buildControls() {
        const controlsGroup = new Adw.PreferencesGroup({
            title: _('Rules'),
            description: _('Managed extensions are enabled only for the checked power profiles. Extensions that are not managed are left untouched.'),
        });
        this.add(controlsGroup);

        this._searchRow = new Adw.EntryRow({
            title: _('Search Extensions'),
        });
        this._searchRow.connect('notify::text', () => this._filterRows());
        controlsGroup.add(this._searchRow);

        const refreshRow = new Adw.ActionRow({
            title: _('Installed Extensions'),
            subtitle: _('Refresh the list after installing or removing extensions.'),
        });
        const refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Refresh'),
        });
        refreshButton.connect('clicked', () => this._loadExtensions());
        refreshRow.add_suffix(refreshButton);
        controlsGroup.add(refreshRow);
    }

    _buildExtensionsGroup() {
        this._extensionsGroup = new Adw.PreferencesGroup();
        this.add(this._extensionsGroup);
        this._setStatus(_('Loading installed extensions...'));
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
                try {
                    this._shellProxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._loadExtensions();
                } catch (error) {
                    if (!isCancelled(error))
                        this._setStatus(_('Could not connect to GNOME Shell Extensions.'));
                }
            });
    }

    _loadExtensions() {
        if (!this._shellProxy)
            return;

        this._setStatus(_('Loading installed extensions...'));
        this._shellProxy.call(
            'ListExtensions',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (proxy, result) => {
                try {
                    const [extensions] = proxy.call_finish(result).deep_unpack();
                    this._showExtensions(this._normalizeExtensions(extensions));
                } catch (error) {
                    if (!isCancelled(error))
                        this._setStatus(_('Could not load installed extensions.'));
                }
            });
    }

    _normalizeExtensions(extensions) {
        return Object.entries(extensions)
            .map(([uuid, info]) => ({
                uuid,
                name: unpackVariant(info.name),
                state: unpackVariant(info.state),
            }))
            .filter(info => info.uuid !== this._selfUuid &&
                info.state !== EXTENSION_STATE.UNINSTALLED)
            .sort((a, b) => (a.name || a.uuid).localeCompare(b.name || b.uuid));
    }

    _showExtensions(extensions) {
        this._clearExtensionRows();

        if (extensions.length === 0) {
            this._setStatus(_('No extensions found.'));
            return;
        }

        this._statusRow = null;

        for (const extensionInfo of extensions) {
            const row = new ExtensionRuleRow(this._settings, extensionInfo);
            this._rows.push(row);
            this._extensionsGroup.add(row);
        }

        this._filterRows();
    }

    _setStatus(message) {
        this._clearExtensionRows();

        this._statusRow = new Adw.ActionRow({
            title: message,
            sensitive: false,
        });
        this._extensionsGroup.add(this._statusRow);
    }

    _clearExtensionRows() {
        for (const row of this._rows)
            this._extensionsGroup.remove(row);

        this._rows = [];

        if (this._statusRow) {
            this._extensionsGroup.remove(this._statusRow);
            this._statusRow = null;
        }
    }

    _filterRows() {
        const query = this._searchRow.text.trim().toLowerCase();

        for (const row of this._rows)
            row.visible = query.length === 0 || row.matches(query);
    }

}

export default class PowerExtensionManagerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(new PowerExtensionManagerPage(settings, this.uuid));
    }
}
