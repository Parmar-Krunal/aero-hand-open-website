# Aero Hand Open -- Unity Digital Twin Integration

This package allows you to import and run the **Aero Hand Open** inside Unity 2022 / 2023 / Unity 6, with real-time bidirectional joint angle mirroring and fingertip force sensing.

---

## 🚀 Quick Setup (3 Minutes)

### 1. Import URDF into Unity
1. Open Unity Package Manager (`Window > Package Manager`).
2. Click `+ > Add package from git URL...` and enter:
   ```text
   https://github.com/Unity-Technologies/URDF-Importer.git?path=/com.unity.robotics.urdf-importer
   ```
3. Copy `ros2/src/aero_hand_open_description` into your Unity `Assets/` directory.
4. Right-click `aero_hand_open_right.urdf` in Unity Project view and choose **Import Robot from URDF**.
5. Select **Articulation Body** as the physics hierarchy.

### 2. Attach Digital Twin Scripts
1. Select the imported `aero_hand_open_right` root GameObject.
2. Add Component: `AeroHandDigitalTwin.cs`.
3. In the Inspector, assign each of the 16 joint Transforms:
   - Thumb: `thumbCmcAbd`, `thumbCmcFlex`, `thumbMcp`, `thumbIp`
   - Index: `indexMcp`, `indexPip`, `indexDip`
   - Middle: `middleMcp`, `middlePip`, `middleDip`
   - Ring: `ringMcp`, `ringPip`, `ringDip`
   - Pinky: `pinkyMcp`, `pinkyPip`, `pinkyDip`
4. Attach `FingertipForceSensor.cs` to the 5 tip links:
   - `right_thumb_tip_link`
   - `right_index_tip_link`
   - `right_middle_tip_link`
   - `right_ring_tip_link`
   - `right_pinky_tip_link`
5. Connect these 5 sensor instances into the corresponding slots in `AeroHandDigitalTwin`.

### 3. Start Telemetry Bridge
In your terminal, start the WebSocket bridge:
```bash
# Real hardware connected to COM3:
python simulation/digital_twin_bridge.py --port COM3 --ws

# Or dry-run simulation mode:
python simulation/digital_twin_bridge.py --dry-run --ws
```

### 4. Press Play in Unity!
- When **Follow Real Hand** is checked: moving the physical hand immediately articulates the Unity 3D model!
- When fingertips touch objects in Unity, contact forces are calculated and fed back into the telemetry stream in Newtons!
- When **Follow Real Hand** is unchecked (Mirror mode): animating or posing the hand in Unity streams servo commands directly to the physical hand!
