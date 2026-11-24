//go:build windows

package sysmem

import (
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	procK32GetProcessMemoryInfo = modKernel32.NewProc("K32GetProcessMemoryInfo")
)

type processMemoryCountersEx struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
	PrivateUsage               uintptr
}

// Collect measures the working set memory of this Go process and all descendant processes (such as WebView2).
func Collect() Stats {
	me := uint32(os.Getpid())
	children := snapshotChildren()

	// BFS from current PID to find all descendant processes (WebView2 browser, renderer, GPU, network, etc.).
	visited := map[uint32]bool{me: true}
	queue := []uint32{me}
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		for _, child := range children[pid] {
			if !visited[child] {
				visited[child] = true
				queue = append(queue, child)
			}
		}
	}

	var stats Stats
	for pid := range visited {
		mem := queryProcessMemory(pid)
		if mem == 0 && pid != me {
			continue
		}
		stats.ProcessCount++
		if pid == me {
			stats.AppBytes += mem
		} else {
			stats.WebViewBytes += mem
		}
	}
	stats.TotalBytes = stats.AppBytes + stats.WebViewBytes
	return stats
}

func snapshotChildren() map[uint32][]uint32 {
	out := map[uint32][]uint32{}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return out
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return out
	}
	for {
		if entry.ParentProcessID != 0 && entry.ProcessID != entry.ParentProcessID {
			out[entry.ParentProcessID] = append(out[entry.ParentProcessID], entry.ProcessID)
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return out
}

func queryProcessMemory(pid uint32) uint64 {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_VM_READ, false, pid)
	if err != nil {
		handle, err = windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			return 0
		}
	}
	defer windows.CloseHandle(handle)

	var pmc processMemoryCountersEx
	pmc.CB = uint32(unsafe.Sizeof(pmc))
	r1, _, _ := syscall.SyscallN(
		procK32GetProcessMemoryInfo.Addr(),
		uintptr(handle),
		uintptr(unsafe.Pointer(&pmc)),
		uintptr(pmc.CB),
	)
	if r1 == 0 {
		return 0
	}
	if pmc.WorkingSetSize > 0 {
		return uint64(pmc.WorkingSetSize)
	}
	return uint64(pmc.PrivateUsage)
}
