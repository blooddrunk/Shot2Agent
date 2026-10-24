//! SDR still capture via WGC desktop interop. No clipboard API is used here.
use serde_json::Value;
pub fn monitors() -> Result<Value, String> {
    #[cfg(windows)]
    {
        platform::monitors()
    }
    #[cfg(not(windows))]
    {
        Err("WINDOWS_CAPTURE_REQUIRED".into())
    }
}
pub fn capture(id: &str) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        platform::capture(id)
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Err("WINDOWS_CAPTURE_REQUIRED".into())
    }
}
fn encode(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > 64_000_000
        || rgba.len() != width as usize * height as usize * 4
    {
        return Err("CAPTURE_SIZE_UNSUPPORTED".into());
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| "CAPTURE_ENCODE_FAILED")?;
        writer
            .write_image_data(rgba)
            .map_err(|_| "CAPTURE_ENCODE_FAILED")?;
    }
    Ok(bytes)
}
#[cfg(windows)]
mod platform {
    use super::*;
    use windows::{
        core::{factory, Interface, BOOL},
        Graphics::{
            Capture::{
                Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
                IDirect3D11CaptureFramePoolStatics2, IGraphicsCaptureSessionStatics,
            },
            DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        },
        Win32::{
            Foundation::{HMODULE, LPARAM, RECT},
            Graphics::{
                Direct3D::D3D_DRIVER_TYPE_HARDWARE, Direct3D11::*, Dxgi::IDXGIDevice, Gdi::*,
            },
            System::WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
                RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
            },
        },
    };
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    struct Monitor {
        handle: HMONITOR,
        id: String,
        rect: RECT,
        primary: bool,
    }
    unsafe extern "system" fn collect(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<Monitor>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(h, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
            let len = info
                .szDevice
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(info.szDevice.len());
            list.push(Monitor {
                handle: h,
                id: String::from_utf16_lossy(&info.szDevice[..len]),
                rect: info.monitorInfo.rcMonitor,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        BOOL(1)
    }
    fn inventory() -> Result<Vec<Monitor>, String> {
        let mut list = Vec::<Monitor>::new();
        unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(collect),
                LPARAM(&mut list as *mut _ as isize),
            )
            .ok()
            .map_err(|_| "CAPTURE_MONITORS_UNAVAILABLE")?;
        }
        if list.is_empty() {
            return Err("CAPTURE_MONITORS_UNAVAILABLE".into());
        }
        Ok(list)
    }
    pub fn monitors() -> Result<Value, String> {
        Ok(Value::Array(inventory()?.iter().map(|m| serde_json::json!({"id":m.id,"width":m.rect.right-m.rect.left,"height":m.rect.bottom-m.rect.top,"primary":m.primary})).collect()))
    }
    pub fn capture(id: &str) -> Result<Vec<u8>, String> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).map_err(|_| "CAPTURE_INITIALIZATION_FAILED")?;
            #[cfg(test)]
            eprintln!("WGC_INITIALIZED");
            let _apartment = Apartment;
            // Scope factories to this apartment; projected statics cache them past
            // temporary background apartment teardown and may leave stale pointers.
            let support = factory::<GraphicsCaptureSession, IGraphicsCaptureSessionStatics>()
                .map_err(|_| "CAPTURE_UNSUPPORTED")?;
            let mut supported = false;
            (support.vtable().IsSupported)(support.as_raw(), &mut supported)
                .ok()
                .map_err(|_| "CAPTURE_UNSUPPORTED")?;
            if !supported {
                return Err("CAPTURE_UNSUPPORTED".into());
            }
            let list = inventory()?;
            let monitor = list
                .iter()
                .find(|m| if id.is_empty() { m.primary } else { m.id == id })
                .ok_or("CAPTURE_MONITOR_REMOVED")?;
            let interop: IGraphicsCaptureItemInterop =
                factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                    .map_err(|_| "CAPTURE_UNSUPPORTED")?;
            let item: GraphicsCaptureItem = interop
                .CreateForMonitor(monitor.handle)
                .map_err(|_| "CAPTURE_ACCESS_DENIED")?;
            #[cfg(test)]
            eprintln!("WGC_ITEM");
            // WGC item/frame sizes are physical pixels; never multiply logical DPI coordinates.
            let size = item.Size().map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            if size.Width <= 0
                || size.Height <= 0
                || i64::from(size.Width) * i64::from(size.Height) > 64_000_000
            {
                return Err("CAPTURE_SIZE_UNSUPPORTED".into());
            }
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            let device = device.ok_or("CAPTURE_DEVICE_FAILED")?;
            #[cfg(test)]
            eprintln!("WGC_DEVICE");
            let context = context.ok_or("CAPTURE_DEVICE_FAILED")?;
            let dxgi: IDXGIDevice = device.cast().map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            let rt: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
                .and_then(|d| d.cast())
                .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            let pool_factory =
                factory::<Direct3D11CaptureFramePool, IDirect3D11CaptureFramePoolStatics2>()
                    .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            let mut pool_raw = std::ptr::null_mut();
            (pool_factory.vtable().CreateFreeThreaded)(
                pool_factory.as_raw(),
                rt.as_raw(),
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                1,
                size,
                &mut pool_raw,
            )
            .ok()
            .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
            if pool_raw.is_null() {
                return Err("CAPTURE_DEVICE_FAILED".into());
            }
            let pool = Direct3D11CaptureFramePool::from_raw(pool_raw);
            let session = pool
                .CreateCaptureSession(&item)
                .map_err(|_| "CAPTURE_ACCESS_DENIED")?;
            #[cfg(test)]
            eprintln!("WGC_POOL");
            let result = (|| {
                session
                    .StartCapture()
                    .map_err(|_| "CAPTURE_ACCESS_DENIED")?;
                #[cfg(test)]
                eprintln!("WGC_STARTED");
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
                let frame = loop {
                    if let Ok(frame) = pool.TryGetNextFrame() {
                        break frame;
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err("CAPTURE_FRAME_TIMEOUT".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                };
                let content = frame.ContentSize().map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                #[cfg(test)]
                eprintln!("WGC_FRAME");
                if content != size {
                    return Err("CAPTURE_MONITOR_CHANGED".into());
                }
                let access: IDirect3DDxgiInterfaceAccess = frame
                    .Surface()
                    .and_then(|s| s.cast())
                    .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                let texture: ID3D11Texture2D =
                    access.GetInterface().map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                texture.GetDesc(&mut desc);
                if desc.Width < size.Width as u32 || desc.Height < size.Height as u32 {
                    return Err("CAPTURE_MONITOR_CHANGED".into());
                }
                desc.Usage = D3D11_USAGE_STAGING;
                desc.BindFlags = 0;
                desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                desc.MiscFlags = 0;
                let mut staging = None;
                device
                    .CreateTexture2D(&desc, None, Some(&mut staging))
                    .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                let staging = staging.ok_or("CAPTURE_DEVICE_FAILED")?;
                context.CopyResource(&staging, &texture);
                #[cfg(test)]
                eprintln!("WGC_COPIED");
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context
                    .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                    .map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                let (w, h) = (size.Width as usize, size.Height as usize);
                if mapped.pData.is_null() || (mapped.RowPitch as usize) < w * 4 {
                    context.Unmap(&staging, 0);
                    return Err("CAPTURE_DEVICE_FAILED".into());
                }
                #[cfg(test)]
                eprintln!("WGC_MAPPED");
                let mut rgba = vec![0u8; w * h * 4];
                for y in 0..h {
                    let row = std::slice::from_raw_parts(
                        (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                        w * 4,
                    );
                    for x in 0..w {
                        let i = (y * w + x) * 4;
                        let p = x * 4;
                        rgba[i..i + 4].copy_from_slice(&[row[p + 2], row[p + 1], row[p], 255]);
                    }
                }
                context.Unmap(&staging, 0);
                frame.Close().map_err(|_| "CAPTURE_DEVICE_FAILED")?;
                encode(w as u32, h as u32, &rgba)
            })();
            let _ = session.Close();
            let _ = pool.Close();
            result
        }
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn png_roundtrip_and_bounds() {
        let rgba = [255, 0, 128, 255, 0, 255, 0, 255];
        let bytes = super::encode(2, 1, &rgba).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut decoded = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut decoded).unwrap();
        assert_eq!(&decoded[..info.buffer_size()], &rgba);
        assert!(super::encode(0, 1, &[]).is_err());
        assert!(super::encode(8001, 8000, &[]).is_err());
    }
}
