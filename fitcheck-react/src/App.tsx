import { useEffect, useRef, useState } from 'react';
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

type GestureMode = "NONE" | "MOVE" | "ROTATE" | "SCALE";

function App() {
  // states
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [pinching, setPinching] = useState(false);
  const [gestureMode, setGestureMode] = useState<GestureMode>("NONE");

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rotationStartRef = useRef<number | null>(null);
  const baseRotationRef = useRef(0);

  // effect
  useEffect(() => {
    if (!videoRef.current) return;

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
      selfieMode: true
    });

    hands.onResults(onResults);

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          await hands.send({ image: videoRef.current! });
        }
      },
      width: 640,
      height: 480
    });

    camera.start();

    // results handling
    function onResults(results: Results) {
      if (!containerRef.current) return;

      // no hands detected
      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        setGestureMode("NONE");
        setPinching(false);
        rotationStartRef.current = null;
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const handsDetected = results.multiHandLandmarks.length;
      const landmarks = results.multiHandLandmarks[0];

      // fingers
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const pinkyTip = landmarks[20];
      const indexBase = landmarks[5];

      // distances for gestures - pinching is dist between thumb&index, rotate is pinching and pinky
      const pinchDist = Math.hypot(
        thumbTip.x - indexTip.x,
        thumbTip.y - indexTip.y
      );
      const pinkyDist = Math.hypot(
        pinkyTip.x - indexTip.x,
        pinkyTip.y - indexTip.y
      );

      const isPinching = pinchDist < 0.05;
      const isRotate = isPinching && pinkyDist > 0.2;
      const isScale = handsDetected === 2 && isPinching;

      setPinching(isPinching);

      // gesture selection - local
      let currentGesture: GestureMode = "NONE";
      
      if (isScale) currentGesture = "SCALE";
      else if (isRotate) currentGesture = "ROTATE";
      else if (isPinching) currentGesture = "MOVE";

      console.log(currentGesture);
      setGestureMode(currentGesture);

      // gesture application
      if (currentGesture === "MOVE") {
        setShirtPos({
          x: indexTip.x * rect.width - 100,
          y: indexTip.y * rect.height - 100,
        });
      }

      if (currentGesture === "ROTATE") {
        // using angle of index finger to rotate shirt
        const angleRad = Math.atan2(
          indexTip.y - indexBase.y,
          indexTip.x - indexBase.x
        );

        // first frame
        if (rotationStartRef.current === null) {
          rotationStartRef.current = angleRad;
          baseRotationRef.current = rotation;
        } else {
          const delta = angleRad - rotationStartRef.current;
          if (Math.abs(delta) > 0.05) {
            setRotation(baseRotationRef.current + delta * (180 / Math.PI));
          }
        }
      } else {
        // reset latch
        rotationStartRef.current = null;
      }

      if (currentGesture === "SCALE") {
        const indexTip1 = results.multiHandLandmarks[0][8];
        const indexTip2 = results.multiHandLandmarks[1][8];

        // mapping the distance between index fingers as scale (limited so it doesnt explode)
        const dist = Math.hypot(indexTip1.x - indexTip2.x, indexTip1.y - indexTip2.y);
        const newScale = Math.min(Math.max(dist * 3, 0.6), 2);
        setScale(newScale);
      }
    }
  }, []);

  // render
  return (
    <div className="app-wrapper">
      <div ref={containerRef} className="video-container">
        <video ref={videoRef} autoPlay playsInline />
        <img
          src={shirtImage}
          className="shirt"
          style={{
            left: shirtPos.x,
            top: shirtPos.y,
            transform: `
              translate(-50%, -50%)
              rotate(${rotation}deg)
              scale(${scale})
            `,
            border: pinching ? "2px solid lime" : "none"
          }}
          draggable={false}
        />
      </div>

      <div className="controls">
        <button onClick={() => setGestureMode("NONE")}>Disable Gestures</button> 
        <button onClick={() => setRotation(0)}>Reset Rotation</button>
        <button onClick={() => setScale(1)}>Reset Scale</button>
      </div>
    </div>
  );
}

export default App
