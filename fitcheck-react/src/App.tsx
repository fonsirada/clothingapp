import { useEffect, useRef, useState } from 'react';
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

function App() {
  // states
  const [pinching, setPinching] = useState(false);
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
        setPinching(false);
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const handsDetected = results.multiHandLandmarks.length;

      //// single hand gestures - pinch, rotate
      // fingers
      const landmarks = results.multiHandLandmarks[0];
      const thumbTip = landmarks[4];
      const indexBase = landmarks[5];
      const indexTip = landmarks[8];

      // pinch - calculating using distance between fingers
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const pinch = distance < 0.05;
      setPinching(pinch);

      if (pinch) {
        setShirtPos({
          x: indexTip.x * rect.width - 100,
          y: indexTip.y * rect.height - 100
        });
      }

      // rotate - calculating using angle of index finger (rad to deg)
      const angleRad = Math.atan2(
        indexTip.y - indexBase.y,
        indexTip.x - indexBase.x
      );
      setRotation(angleRad * (180 / Math.PI));

      //// two hand gestures - scale
      if (handsDetected === 2) {
        // fingers
        const hand1 = results.multiHandLandmarks[0];
        const hand2 = results.multiHandLandmarks[1];
        const indexTip1 = hand1[8];
        const indexTip2 = hand2[8];

        // mapping the distance between index fingers as scale (limited so it doesnt explode)
        const dx = indexTip1.x - indexTip2.x;
        const dy = indexTip1.y - indexTip2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const newScale = Math.min(Math.max(distance * 3, 0.5), 2);
        setScale(newScale);
      }
    }
  }, []);

  // render
  return (
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
  );
}

export default App
