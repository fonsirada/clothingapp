import { useEffect, useRef, useState } from 'react';
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";

const DWELL_TIME = 500;
const ROTATION_SPEED = 0.5;
const SCALE_SPEED = 0.5;

function App() {
  //// states
  const [shirtPos, setShirtPos] = useState({ x: 125, y: 250});
  const [rotation, setRotation] = useState(75);
  const [scale, setScale] = useState(.75);
  const [fingerPos, setFingerPos] = useState<{ x: number; y: number } | null>(null);
  const [pinching, setPinching] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("NONE");

  //// refs
  // html elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLDivElement>(null);
  const rotateBtnRef = useRef<HTMLDivElement>(null);
  const scaleBtnRef = useRef<HTMLDivElement>(null);
  // rotation refs
  const rotationStartRef = useRef<number | null>(null);
  const baseRotationRef = useRef(75);
  const rotationRef = useRef(75);
  // scale refs
  const scaleStartRef = useRef<number | null>(null);
  const baseScaleRef = useRef(.75);
  const scaleRef = useRef(.75);
  // hover dwell system
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);
  const hoverConsumedRef = useRef(false);
  // current tool ref
  const activeToolRef = useRef<Tool>("NONE");
  const wasPinchingRef = useRef(false);

  // mediapipe effect
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
      minTrackingConfidence: 0.7,
      selfieMode: true
    });

    hands.onResults((results) => {
      // no hands detected
      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        setPinching(false);
        setFingerPos(null);
        hoverToolRef.current = "NONE";
        hoverStartRef.current = null;
        rotationStartRef.current = null;
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const landmarks = results.multiHandLandmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const fingerX = indexTip.x * rect.width;
      const fingerY = indexTip.y * rect.height;
      setFingerPos({ x: fingerX, y: fingerY });

      // detect pinching
      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
      const isPinching = pinchDist < 0.05;
      setPinching(isPinching);

      // selecting and handling tools
      handleHover(fingerX, fingerY, isPinching);
      handleTool(fingerX, fingerY, isPinching);
    });

    // starting camera
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
  }, []);

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

  //// tool selection
  function handleHover(x: number, y: number, isPinching: boolean) {
    let hoveredTool: Tool = "NONE";

    if (!isPinching) {
      if (isHovering(x, y, moveBtnRef.current)) hoveredTool = "MOVE";
      else if (isHovering(x, y, rotateBtnRef.current)) hoveredTool = "ROTATE";
      else if (isHovering(x, y, scaleBtnRef.current)) hoveredTool = "SCALE";
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
  }

  function handleTool(fingerX: number, fingerY: number, isPinching: boolean) {
    const currentTool = activeToolRef.current;

    if (wasPinchingRef.current && !isPinching) {
      rotationStartRef.current = null;
      scaleStartRef.current = null;
    }
    wasPinchingRef.current = isPinching;

    ///// execute tool
    if (currentTool === "MOVE" && isPinching) {
      setShirtPos({ x: fingerX, y: fingerY });
    }

    if (currentTool === "ROTATE" && isPinching) {
      // using vertical movement to rotate shirt
      if (rotationStartRef.current === null) {
        rotationStartRef.current = fingerY;
        baseRotationRef.current = rotationRef.current;
        return;
      }
      const deltaY = fingerY - rotationStartRef.current;
      const newRotation = baseRotationRef.current + deltaY * ROTATION_SPEED;
      rotationRef.current = newRotation;
      setRotation(newRotation);
    }

    if (currentTool === "SCALE" && isPinching) {
     // initialize latch
     if (scaleStartRef.current === null) {
      scaleStartRef.current = fingerX;
      baseScaleRef.current = scaleRef.current;
      return;
     }

     const deltaX = fingerX - scaleStartRef.current;
     const newScale = Math.min(Math.max(baseScaleRef.current + deltaX * SCALE_SPEED * 0.01, 0.5), 2.5);
     scaleRef.current = newScale;
     setScale(newScale);
    }
  }

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

        {/* {fingerPos && (
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
        )} */}

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