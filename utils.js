import Gio from 'gi://Gio';

export const SHELL_EXTENSIONS_BUS_NAME = 'org.gnome.Shell.Extensions';
export const SHELL_EXTENSIONS_OBJECT_PATH = '/org/gnome/Shell/Extensions';
export const SHELL_EXTENSIONS_INTERFACE = 'org.gnome.Shell.Extensions';

export const EXTENSION_STATE = {
    ERROR: 3,
    OUT_OF_DATE: 4,
    DOWNLOADING: 5,
    UNINSTALLED: 99,
};

export function isCancelled(error) {
    return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
