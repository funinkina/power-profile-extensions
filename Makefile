UUID = power-extension-manager@funinkina.co.in
SCHEMA = schemas/org.gnome.shell.extensions.power-extension-manager.gschema.xml
ZIP = $(UUID).shell-extension.zip

.PHONY: schemas pack install enable disable prefs clean

schemas:
	glib-compile-schemas schemas

pack: schemas
	gnome-extensions pack -f --schema=$(SCHEMA) --extra-source=utils.js .

install: pack
	gnome-extensions install --force $(ZIP)

enable: install
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

clean:
	rm -f $(ZIP)
