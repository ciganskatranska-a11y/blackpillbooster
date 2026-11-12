param([string]$Action = "list", [string]$Id = "")

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace Blackpill {

	[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
	class DeviceEnumeratorClass {
	}

	[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
	class PolicyConfigClass {
	}

	[StructLayout(LayoutKind.Sequential)]
	struct PropertyKey {
		public Guid FormatId;
		public int PropertyId;
	}

	[StructLayout(LayoutKind.Explicit, Size = 24)]
	struct PropVariant {
		[FieldOffset(0)] public short Type;
		[FieldOffset(8)] public IntPtr Pointer;
	}

	[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IPropertyStore {
		[PreserveSig] int GetCount(out int count);
		[PreserveSig] int GetAt(int index, out PropertyKey key);
		[PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
	}

	[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMMDevice {
		[PreserveSig] int Activate(ref Guid iid, int context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
		[PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
		[PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
		[PreserveSig] int GetState(out int state);
	}

	[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMMDeviceCollection {
		[PreserveSig] int GetCount(out int count);
		[PreserveSig] int Item(int index, out IMMDevice device);
	}

	[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMMDeviceEnumerator {
		[PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
		[PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
	}

	[Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IPolicyConfig {
		[PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
		[PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int isDefault, IntPtr format);
		[PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
		[PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
		[PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int isDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
		[PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
		[PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
		[PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
		[PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int isFxStore, IntPtr key, IntPtr value);
		[PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int isFxStore, IntPtr key, IntPtr value);
		[PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
		[PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int isVisible);
	}

	public static class Audio {

		[DllImport("ole32.dll")]
		static extern int PropVariantClear(ref PropVariant value);

		static void Check(int result) {
			if (result < 0) Marshal.ThrowExceptionForHR(result);
		}

		static string Escape(string text) {
			StringBuilder builder = new StringBuilder();
			foreach (char character in text) {
				if (character == '"' || character == '\\') builder.Append('\\').Append(character);
				else if (character < 32 || character > 126) builder.Append("\\u").Append(((int)character).ToString("x4"));
				else builder.Append(character);
			}
			return builder.ToString();
		}

		static string NameOf(IMMDevice device) {
			IPropertyStore store;
			Check(device.OpenPropertyStore(0, out store));
			PropertyKey key = new PropertyKey();
			key.FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0");
			key.PropertyId = 14;
			PropVariant value;
			Check(store.GetValue(ref key, out value));
			string name = value.Type == 31 && value.Pointer != IntPtr.Zero ? Marshal.PtrToStringUni(value.Pointer) : "";
			PropVariantClear(ref value);
			return name ?? "";
		}

		public static string List() {
			IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new DeviceEnumeratorClass();
			string defaultId = "";
			IMMDevice defaultDevice;
			if (enumerator.GetDefaultAudioEndpoint(0, 1, out defaultDevice) >= 0 && defaultDevice != null) Check(defaultDevice.GetId(out defaultId));
			string captureId = "";
			IMMDevice captureDevice;
			if (enumerator.GetDefaultAudioEndpoint(1, 1, out captureDevice) >= 0 && captureDevice != null) Check(captureDevice.GetId(out captureId));

			IMMDeviceCollection collection;
			Check(enumerator.EnumAudioEndpoints(0, 1, out collection));
			int count;
			Check(collection.GetCount(out count));

			StringBuilder builder = new StringBuilder();
			builder.Append("{\"default\":\"").Append(Escape(defaultId)).Append("\",\"defaultCapture\":\"").Append(Escape(captureId)).Append("\",\"devices\":[");
			for (int index = 0; index < count; index++) {
				IMMDevice device;
				Check(collection.Item(index, out device));
				string id;
				Check(device.GetId(out id));
				if (index > 0) builder.Append(',');
				builder.Append("{\"id\":\"").Append(Escape(id)).Append("\",\"name\":\"").Append(Escape(NameOf(device))).Append("\"}");
			}
			builder.Append("]}");
			return builder.ToString();
		}

		public static string SetDefault(string id, bool isEveryRole) {
			IPolicyConfig config = (IPolicyConfig)new PolicyConfigClass();
			Check(config.SetDefaultEndpoint(id, 0));
			Check(config.SetDefaultEndpoint(id, 1));
			if (isEveryRole) Check(config.SetDefaultEndpoint(id, 2));
			return "{\"ok\":true}";
		}

	}

}
'@

if ($Action -eq "set") {
	Write-Output ([Blackpill.Audio]::SetDefault($Id, $false))
} elseif ($Action -eq "setall") {
	Write-Output ([Blackpill.Audio]::SetDefault($Id, $true))
} else {
	Write-Output ([Blackpill.Audio]::List())
}
