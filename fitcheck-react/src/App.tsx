import { useEffect, useRef, useState } from 'react';
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

function App() {
  // states
  const [pinching, setPinching] = useState(false);
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});

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
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 640,
      height: 480
    });

    camera.start();

    function onResults(results: Results) {
      if (!results.multiHandLandmarks || !containerRef.current) return;

      const landmarks = results.multiHandLandmarks[0];

      // thumb tip & index tip
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];

      // dist between fingers
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const pinch = distance < 0.05;
      setPinching(pinch);

      if (pinch) {
        const rect = containerRef.current.getBoundingClientRect();

        setShirtPos({
          x: indexTip.x * rect.width - 100,
          y: indexTip.y * rect.height - 100
        });
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
          border: pinching ? "2px solid lime" : "none"
        }}
        draggable={false}
      />
    </div>
  );
}

export default App
