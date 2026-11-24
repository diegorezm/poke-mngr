//go:build windows

package updater

import (
	"os/exec"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
)

// launchSilentInstaller starts the NSIS installer silently (/S) in a detached process
// so PokeMngr can exit immediately and let the installer replace the executable cleanly.
func launchSilentInstaller(installerPath string) error {
	cmd := exec.Command(installerPath, "/S")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup | detachedProcess,
		HideWindow:    true,
	}
	return cmd.Start()
}
