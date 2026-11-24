//go:build !windows

package updater

import "fmt"

func launchSilentInstaller(_ string) error {
	return fmt.Errorf("instalador automático NSIS disponível apenas no Windows")
}
