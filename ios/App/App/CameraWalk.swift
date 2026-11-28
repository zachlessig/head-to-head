import UIKit
import ARKit
import SceneKit
import Capacitor

// Camera walk (Zach 2026-11-15): walk the edge of a lawn or bed with the phone pointed at it.
// ARKit's motion tracking (camera + LiDAR on Pro phones) follows the phone, and a crosshair in the
// middle of the screen marks the spot on the ground being traced. Points come back to the web app
// in feet, x east and y north, and js/trace.js turns them into straight edges and curves.

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CameraWalkPlugin())
    }

    // Rubber band (Zach 2026-11-27: "the rubber band feature isnt on the app on my phone when i see
    // my jobs"): Capacitor turns the web view's bounce off, so turn it back on. The job screen keeps
    // still on its own (css/app.css sets overscroll-behavior: none while a job is open).
    override open func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = true
    }
}

@objc(CameraWalkPlugin)
public class CameraWalkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CameraWalkPlugin"
    public let jsName = "CameraWalk"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        call.resolve([
            "available": ARWorldTrackingConfiguration.isSupported,
            "lidar": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("This phone can't do camera walking.")
            return
        }
        let what = call.getString("what") ?? "lawn"
        DispatchQueue.main.async {
            let vc = CameraWalkViewController()
            vc.what = what
            vc.modalPresentationStyle = .fullScreen
            vc.onDone = { points in
                if let points = points {
                    call.resolve(["points": points])
                } else {
                    call.resolve(["cancelled": true])
                }
            }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }
}

final class CameraWalkViewController: UIViewController, ARSessionDelegate {
    var what = "lawn"
    var onDone: (([[String: Any]]?) -> Void)?

    private let sceneView = ARSCNView()
    private let crosshair = UIView()
    private let status = UILabel()
    private let readout = UILabel()
    private let startBtn = UIButton(type: .system)
    private let cornerBtn = UIButton(type: .system)
    private let finishBtn = UIButton(type: .system)
    private let cancelBtn = UIButton(type: .system)
    private let undoBtn = UIButton(type: .system)

    private struct Pt { var p: simd_float3; var corner: Bool }
    private var trail: [Pt] = []
    private var recording = false
    private var aim: simd_float3?
    private var trailNode = SCNNode()
    private var timer: Timer?
    private var tracking: ARCamera.TrackingState = .notAvailable

    private let minStep: Float = 0.15 // m between trail points, about half a foot
    private let ftPerM = 3.28084

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        sceneView.frame = view.bounds
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.session.delegate = self
        sceneView.automaticallyUpdatesLighting = true
        sceneView.scene.rootNode.addChildNode(trailNode)
        view.addSubview(sceneView)
        buildUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let config = ARWorldTrackingConfiguration()
        // x east, -z north, so the shape comes back facing the right way on the map
        config.worldAlignment = .gravityAndHeading
        config.planeDetection = [.horizontal]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }
        sceneView.session.run(config)
        UIApplication.shared.isIdleTimerDisabled = true
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        timer?.invalidate()
        sceneView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    override var prefersStatusBarHidden: Bool { true }

    // MARK: UI

    private func style(_ b: UIButton, _ title: String, primary: Bool = false) {
        var c = UIButton.Configuration.filled()
        c.title = title
        c.cornerStyle = .large
        c.baseBackgroundColor = primary
            ? UIColor(red: 0.12, green: 0.42, blue: 0.27, alpha: 1)
            : UIColor(white: 1, alpha: 0.92)
        c.baseForegroundColor = primary ? .white : UIColor(red: 0.11, green: 0.14, blue: 0.13, alpha: 1)
        c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a
            a.font = UIFont.systemFont(ofSize: 18, weight: .semibold)
            return a
        }
        c.contentInsets = NSDirectionalEdgeInsets(top: 16, leading: 12, bottom: 16, trailing: 12)
        b.configuration = c
    }

    private func buildUI() {
        // crosshair: a ring with a dot, sitting on the spot being traced
        crosshair.translatesAutoresizingMaskIntoConstraints = false
        crosshair.isUserInteractionEnabled = false
        crosshair.layer.borderColor = UIColor.white.cgColor
        crosshair.layer.borderWidth = 3
        crosshair.layer.cornerRadius = 22
        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = UIColor(red: 1, green: 0.35, blue: 0.2, alpha: 1)
        dot.layer.cornerRadius = 4
        crosshair.addSubview(dot)
        view.addSubview(crosshair)

        let top = UIView()
        top.translatesAutoresizingMaskIntoConstraints = false
        top.backgroundColor = UIColor(white: 0, alpha: 0.55)
        top.layer.cornerRadius = 14
        view.addSubview(top)
        for l in [status, readout] {
            l.translatesAutoresizingMaskIntoConstraints = false
            l.textColor = .white
            l.numberOfLines = 0
            l.textAlignment = .center
            top.addSubview(l)
        }
        status.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        readout.font = UIFont.monospacedDigitSystemFont(ofSize: 15, weight: .regular)

        style(cancelBtn, "Cancel")
        style(undoBtn, "Undo")
        style(startBtn, "Start", primary: true)
        style(cornerBtn, "Corner")
        style(finishBtn, "Finish", primary: true)
        cancelBtn.addTarget(self, action: #selector(cancelTap), for: .touchUpInside)
        undoBtn.addTarget(self, action: #selector(undoTap), for: .touchUpInside)
        startBtn.addTarget(self, action: #selector(startTap), for: .touchUpInside)
        cornerBtn.addTarget(self, action: #selector(cornerTap), for: .touchUpInside)
        finishBtn.addTarget(self, action: #selector(finishTap), for: .touchUpInside)

        let row1 = UIStackView(arrangedSubviews: [cancelBtn, undoBtn])
        let row2 = UIStackView(arrangedSubviews: [startBtn, cornerBtn, finishBtn])
        for r in [row1, row2] {
            r.axis = .horizontal
            r.spacing = 10
            r.distribution = .fillEqually
        }
        let rows = UIStackView(arrangedSubviews: [row1, row2])
        rows.axis = .vertical
        rows.spacing = 10
        rows.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(rows)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            crosshair.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            crosshair.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            crosshair.widthAnchor.constraint(equalToConstant: 44),
            crosshair.heightAnchor.constraint(equalToConstant: 44),
            dot.centerXAnchor.constraint(equalTo: crosshair.centerXAnchor),
            dot.centerYAnchor.constraint(equalTo: crosshair.centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 8),
            dot.heightAnchor.constraint(equalToConstant: 8),

            top.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            top.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            top.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            status.topAnchor.constraint(equalTo: top.topAnchor, constant: 12),
            status.leadingAnchor.constraint(equalTo: top.leadingAnchor, constant: 12),
            status.trailingAnchor.constraint(equalTo: top.trailingAnchor, constant: -12),
            readout.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 4),
            readout.leadingAnchor.constraint(equalTo: top.leadingAnchor, constant: 12),
            readout.trailingAnchor.constraint(equalTo: top.trailingAnchor, constant: -12),
            readout.bottomAnchor.constraint(equalTo: top.bottomAnchor, constant: -12),

            rows.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            rows.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            rows.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
        ])
        refreshUI()
    }

    // MARK: tracking

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        tracking = camera.trackingState
    }

    private func groundHit() -> simd_float3? {
        let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
        guard let q = sceneView.raycastQuery(from: center, allowing: .estimatedPlane, alignment: .any),
              let hit = sceneView.session.raycast(q).first else { return nil }
        let c = hit.worldTransform.columns.3
        return simd_float3(c.x, c.y, c.z)
    }

    private func tick() {
        aim = groundHit()
        if recording, case .normal = tracking, let a = aim {
            if let last = trail.last {
                if simd_distance(simd_float2(last.p.x, last.p.z), simd_float2(a.x, a.z)) >= minStep {
                    add(a, corner: false)
                }
            } else {
                add(a, corner: true)
            }
        }
        refreshUI()
    }

    private func add(_ p: simd_float3, corner: Bool) {
        trail.append(Pt(p: p, corner: corner))
        drawTrail()
    }

    private func drawTrail() {
        trailNode.childNodes.forEach { $0.removeFromParentNode() }
        guard !trail.isEmpty else { return }
        let line = trail.map { SCNVector3($0.p.x, $0.p.y + 0.01, $0.p.z) }
        if line.count >= 2 {
            var idx: [Int32] = []
            for i in 0..<(line.count - 1) { idx += [Int32(i), Int32(i + 1)] }
            let geo = SCNGeometry(
                sources: [SCNGeometrySource(vertices: line)],
                elements: [SCNGeometryElement(indices: idx, primitiveType: .line)]
            )
            let m = SCNMaterial()
            m.diffuse.contents = UIColor(red: 1, green: 0.35, blue: 0.2, alpha: 1)
            m.lightingModel = .constant
            geo.materials = [m]
            trailNode.addChildNode(SCNNode(geometry: geo))
        }
        for pt in trail where pt.corner {
            let s = SCNSphere(radius: 0.06)
            s.firstMaterial?.diffuse.contents = UIColor.white
            s.firstMaterial?.lightingModel = .constant
            let n = SCNNode(geometry: s)
            n.position = SCNVector3(pt.p.x, pt.p.y + 0.03, pt.p.z)
            trailNode.addChildNode(n)
        }
    }

    private func walkedFt() -> Double {
        var m: Float = 0
        for i in stride(from: 1, to: trail.count, by: 1) {
            m += simd_distance(simd_float2(trail[i - 1].p.x, trail[i - 1].p.z),
                               simd_float2(trail[i].p.x, trail[i].p.z))
        }
        return Double(m) * ftPerM
    }

    private func fromStartFt() -> Double? {
        guard let f = trail.first, let a = aim ?? trail.last?.p else { return nil }
        return Double(simd_distance(simd_float2(f.p.x, f.p.z), simd_float2(a.x, a.z))) * ftPerM
    }

    private func refreshUI() {
        let name = what == "bed" ? "bed" : "lawn"
        var s: String
        switch tracking {
        case .notAvailable:
            s = "Starting the camera..."
        case .limited(let why):
            switch why {
            case .initializing, .relocalizing: s = "Move the phone around slowly to get started."
            case .excessiveMotion: s = "Slow down a little."
            case .insufficientFeatures: s = "Point at the ground. It needs more to see."
            @unknown default: s = "Hold on..."
            }
        case .normal:
            if aim == nil {
                s = "Point the circle at the ground."
            } else if trail.isEmpty {
                s = "Put the circle on a corner of the \(name) edge, then tap Start."
            } else if recording {
                s = "Walk the edge, keeping the circle on it. Tap Corner on each corner."
            } else {
                s = "Paused. Tap Start to keep going."
            }
        }
        status.text = s
        var r = ""
        if !trail.isEmpty {
            r = String(format: "%.0f ft walked", walkedFt())
            if let d = fromStartFt(), trail.count > 20 {
                r += String(format: " · %.1f ft from start", d)
            }
        }
        readout.text = r
        readout.isHidden = r.isEmpty
        var c = startBtn.configuration
        c?.title = recording ? "Pause" : (trail.isEmpty ? "Start" : "Resume")
        startBtn.configuration = c
        cornerBtn.isEnabled = recording && aim != nil
        finishBtn.isEnabled = trail.count >= 8
        undoBtn.isEnabled = !trail.isEmpty
        crosshair.layer.borderColor = (aim == nil ? UIColor(white: 1, alpha: 0.4) : UIColor.white).cgColor
    }

    // MARK: buttons

    @objc private func startTap() {
        if !recording && trail.isEmpty {
            guard case .normal = tracking, aim != nil else { return }
        }
        recording.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        refreshUI()
    }

    @objc private func cornerTap() {
        guard let a = aim else { return }
        // a corner replaces trail points right around it, so it sits exactly where the circle was
        while let last = trail.last, !last.corner,
              simd_distance(simd_float2(last.p.x, last.p.z), simd_float2(a.x, a.z)) < minStep {
            trail.removeLast()
        }
        add(a, corner: true)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        refreshUI()
    }

    @objc private func undoTap() {
        // back up about 3 ft, or to the last corner, whichever comes first
        guard !trail.isEmpty else { return }
        var gone: Float = 0
        while trail.count > 1 {
            let last = trail.removeLast()
            if let prev = trail.last {
                gone += simd_distance(simd_float2(last.p.x, last.p.z), simd_float2(prev.p.x, prev.p.z))
            }
            if last.corner || gone > 0.9 { break }
        }
        if trail.count == 1 && gone == 0 { trail.removeAll() }
        recording = false
        drawTrail()
        refreshUI()
    }

    @objc private func finishTap() {
        guard trail.count >= 8 else { return }
        if let d = fromStartFt(), d > 6 {
            let a = UIAlertController(
                title: String(format: "You're %.0f ft from where you started", d),
                message: "Walk back to the start so the shape closes, then tap Finish. Or finish here and the app joins the ends with a straight line.",
                preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Keep walking", style: .cancel))
            a.addAction(UIAlertAction(title: "Finish anyway", style: .default) { _ in self.done() })
            present(a, animated: true)
            return
        }
        done()
    }

    private func done() {
        let pts: [[String: Any]] = trail.map {
            ["x": Double($0.p.x) * ftPerM, "y": Double(-$0.p.z) * ftPerM, "corner": $0.corner]
        }
        let cb = onDone
        onDone = nil
        dismiss(animated: true) { cb?(pts) }
    }

    @objc private func cancelTap() {
        let close = {
            let cb = self.onDone
            self.onDone = nil
            self.dismiss(animated: true) { cb?(nil) }
        }
        if trail.count < 10 { close(); return }
        let a = UIAlertController(title: "Throw away this walk?", message: nil, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Keep walking", style: .cancel))
        a.addAction(UIAlertAction(title: "Throw it away", style: .destructive) { _ in close() })
        present(a, animated: true)
    }
}
