import { useEffect, useRef, useState } from 'react';
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";
const DWELL_TIME = 500;

function App() {
  //// states
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [pinching, setPinching] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("NONE");

  //// refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLDivElement>(null);
  const rotateBtnRef = useRef<HTMLDivElement>(null);
  const scaleBtnRef = useRef<HTMLDivElement>(null);
  // rotation latch
  const rotationStartRef = useRef<number | null>(null);
  const baseRotationRef = useRef(0);
  // button dwell system
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);

  function isHovering(x: number, y: number, ele: HTMLDivElement | null) {
    if (!ele) return false;
    const rect = ele.getBoundingClientRect();
    console.log(x, y, rect.left, rect.right, rect.top, rect.bottom);
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  // mediapipe effect
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
      width: 1280,
      height: 720
    });

    camera.start();

    // results handling
    function onResults(results: Results) {
      if (!containerRef.current) return;

      // no hands detected
      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        setPinching(false);
        setActiveTool("NONE");
        hoverToolRef.current = "NONE";
        hoverStartRef.current = null;
        rotationStartRef.current = null;
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const handsDetected = results.multiHandLandmarks.length;
      const landmarks = results.multiHandLandmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const indexBase = landmarks[5];
      const fingerX = rect.left + indexTip.x * rect.width;
      const fingerY = rect.top + indexTip.y * rect.height;

      // detecting pinching using distance between thumb and index
      const pinchDist = Math.hypot(
        thumbTip.x - indexTip.x,
        thumbTip.y - indexTip.y
      );
      const isPinching = pinchDist < 0.05;
      setPinching(isPinching);

      //// tool selection
      let hoveredTool: Tool = "NONE";
      if (!isPinching) {
        if (isHovering(fingerX, fingerY, moveBtnRef.current)) {
          hoveredTool = "MOVE";
        } else if (isHovering(fingerX, fingerY, rotateBtnRef.current)) {
          hoveredTool = "ROTATE";
        } else if (isHovering(fingerX, fingerY, scaleBtnRef.current)) {
          hoveredTool = "SCALE";
        }
      }
      console.log(hoveredTool);

      let currentTool = "NONE";
      const now = performance.now();

      // not hovering over a button
      if (hoveredTool === "NONE") {
        hoverToolRef.current = "NONE";
        hoverStartRef.current = null;
        return;
      }
      // hovering over a new button
      if (hoverToolRef.current !== hoveredTool) {
        hoverToolRef.current = hoveredTool;
        hoverStartRef.current = now;
        return;
      }
      // hovering over same button for at least .5 seconds
      if (hoverStartRef.current && now - hoverStartRef.current > DWELL_TIME) {
        // toggle lock
        setActiveTool((prev) => prev === hoveredTool ? "NONE" : hoveredTool);
        currentTool = currentTool === hoveredTool ? "NONE" : hoveredTool;
        hoverToolRef.current = "NONE";
        hoverStartRef.current = null;
      }

      ///// execute tool
      if (currentTool === "MOVE" && isPinching) {
        setShirtPos({
          x: fingerX, // x: indexTip.x * rect.width - 100,
          y: fingerY // y: indexTip.y * rect.height - 100,
        });
      }

      if (currentTool === "ROTATE" && isPinching) {
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

      if (currentTool === "SCALE" && isPinching && handsDetected === 2) {
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

        <div className="toolbar">
          <div ref={moveBtnRef} className={`tool ${activeTool === "MOVE" ? "active" : ""}`}>MOVE</div>
          <div ref={rotateBtnRef} className={`tool ${activeTool === "ROTATE" ? "active" : ""}`}>ROTATE</div>
          <div ref={scaleBtnRef} className={`tool ${activeTool === "SCALE" ? "active" : ""}`}>SCALE</div>
        </div>
      </div>
    </div>
  );
}

export default App
