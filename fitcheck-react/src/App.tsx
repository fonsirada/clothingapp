import { useEffect, useRef, useState } from 'react';
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";
const DWELL_TIME = 500;
const ROTATION_SPEED = 0.005;
const SCALE_SPEED = 0.005;

function App() {
  //// states
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});
  const [fingerPos, setFingerPos] = useState<{ x: number; y: number } | null>(null);
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
  // hover dwell system
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);
  const hoverConsumedRef = useRef(false);
  // current tool ref
  const activeToolRef = useRef<Tool>("NONE");
  // finger refs for rotating and scaling
  const lastFingerXRef = useRef<number | null>(null);
  const lastFingerYRef = useRef<number | null>(null);

  function isHovering(x: number, y: number, ele: HTMLDivElement | null) {
    if (!ele) return false;
    const eleRect = ele.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    // position of the element relative to video container
    const left = eleRect.left - containerRect.left;
    const top = eleRect.top - containerRect.top;
    const right = eleRect.right - containerRect.left;
    const bottom = eleRect.bottom - containerRect.top;

    return x >= left && x <= right && y >= top && y <= bottom;
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
        setFingerPos(null);
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
      const fingerX = indexTip.x * rect.width;
      const fingerY = indexTip.y * rect.height;
      setFingerPos({ x: fingerX, y: fingerY });

      // detecting pinching using distance between thumb and index
      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
      const isPinching = pinchDist < 0.05;
      setPinching(isPinching);

      //// tool selection
      let hoveredTool: Tool = "NONE";
      if (!isPinching) {
        if (isHovering(fingerX, fingerY, moveBtnRef.current)) hoveredTool = "MOVE";
        else if (isHovering(fingerX, fingerY, rotateBtnRef.current)) hoveredTool = "ROTATE";
        else if (isHovering(fingerX, fingerY, scaleBtnRef.current)) hoveredTool = "SCALE";
      }
 
      const now = performance.now();
      
      // not hovering over a button
      if (hoveredTool === "NONE") {
        hoverToolRef.current = "NONE";
        hoverStartRef.current = null;
        hoverConsumedRef.current = false;
      } else if (hoverToolRef.current !== hoveredTool) {
        // hovering over a new button
        hoverToolRef.current = hoveredTool;
        hoverStartRef.current = now;
        hoverConsumedRef.current = false;
      } else if (!hoverConsumedRef.current && hoverStartRef.current && now - hoverStartRef.current > DWELL_TIME) {
        // hovering over same button for at least .5 seconds, but not yet toggled
        const newTool = activeToolRef.current == hoveredTool ? "NONE" : hoveredTool;
        activeToolRef.current = newTool;
        setActiveTool(newTool);
        // toggle lock
        hoverConsumedRef.current = true;
      }

      const currentTool = activeToolRef.current;
      lastFingerXRef.current = null;
      lastFingerYRef.current = null;

      ///// execute tool
      if (currentTool === "MOVE" && isPinching) {
        setShirtPos({
          x: fingerX, // x: indexTip.x * rect.width - 100,
          y: fingerY // y: indexTip.y * rect.height - 100,
        });
      }

      if (currentTool === "ROTATE" && isPinching) {
        console.log(rotationStartRef.current, fingerY);
        // using vertical movement to rotate shirt
        if (rotationStartRef.current === null) {
          rotationStartRef.current = fingerY;
          baseRotationRef.current = rotation;
          return;
        }
        const deltaY = fingerY - rotationStartRef.current;
        const newRotation = baseRotationRef.current + deltaY * ROTATION_SPEED;
        setRotation(newRotation);
      } else {
        // reset latch
        rotationStartRef.current = null;
      }

      if (currentTool === "SCALE" && isPinching) {
        if (lastFingerXRef.current !== null) {
          const deltaX = fingerX - lastFingerXRef.current;
          setScale((s) => Math.min(Math.max(s + deltaX * SCALE_SPEED, 0.5), 2));
        }
        lastFingerXRef.current = fingerX;
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

        {fingerPos && (
          <div
            style={{
              position: "absolute",
              left: fingerPos.x,
              top: fingerPos.y,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "red",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 10
            }}
          />
        )}

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