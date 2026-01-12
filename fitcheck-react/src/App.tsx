import { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

//// constants
const DWELL_TIME = 500;
const ROTATION_SPEED = 0.1;
const SCALE_SPEED = 0.1;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const PINCH_THRESHOLD = 0.05;
const CURSOR_SIZE = 14;

const MEDIAPIPE_CONFIG = {
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
  selfieMode: true,
};

const CAMERA_CONFIG = {
  width: 1280,
  height: 720
};

//// types
type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";

interface Position {
  x: number;
  y: number;
}

interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

interface TransformState {
  position: Position;
  rotation: number;
  scale: number;
}

//// utility functions
/**
 * calculates if a point is within an element's hitbox
 * relative to a container element
 */
function isPointInElement(
  point: Position, 
  element: HTMLElement | null,
  container: HTMLElement | null
): boolean {
  if (!element || !container) return false;

  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  // position of the element relative to video container
  const left = elementRect.left - containerRect.left;
  const top = elementRect.top - containerRect.top;
  const right = elementRect.right - containerRect.left;
  const bottom = elementRect.bottom - containerRect.top;

  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

/**
 * detects pinching with distance between thumb and index finger
 */
function detectPinch(thumbTip: HandLandmark, indexTip: HandLandmark): boolean {
  const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  return dist < PINCH_THRESHOLD;
}

/**
 * clamps a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// hand tracking
function useHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onHandDetected: (fingerPos: Position, isPinching: boolean) => void,
  onNoHand: () => void
) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    let hands: Hands | null = null;
    let camera: Camera | null = null;

    const initializeTracking = async () => {
      try {
        hands = new Hands({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions(MEDIAPIPE_CONFIG);
        
        hands.onResults((results) => {
          if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            onNoHand();
            return;
          }

          const containerRect = containerRef.current?.getBoundingClientRect();
          if (!containerRect) return;

          const landmarks = results.multiHandLandmarks[0];
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];

          const fingerPos: Position = {
            x: indexTip.x * containerRect.width,
            y: indexTip.y * containerRect.height,
          };

          const isPinching = detectPinch(thumbTip, indexTip);
          onHandDetected(fingerPos, isPinching);
        });

        camera = new Camera(videoRef.current!, {
          onFrame: async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              await hands!.send({ image: videoRef.current! });
            }
          },
          width: CAMERA_CONFIG.width,
          height: CAMERA_CONFIG.height,
        });

        await camera.start();
        setIsInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize camera");
        console.error("Hand tracking initialization error:", err);
      }
    };

    initializeTracking();
    return () => {
      camera?.stop();
      hands?.close();
    };
  }, [videoRef, containerRef, onHandDetected, onNoHand]);

  return {isInitialized, error};
}

//// main component

function App() {
  //// states
  const [transform, setTransform] = useState<TransformState>({
    position: { x: 125, y: 250},
    rotation: 75,
    scale: 0.75,
  });
  const [fingerPos, setFingerPos] = useState<Position | null>(null);
  const [isPinching, setPinching] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("NONE");

  //// refs - dom elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLDivElement>(null);
  const rotateBtnRef = useRef<HTMLDivElement>(null);
  const scaleBtnRef = useRef<HTMLDivElement>(null);
  
  //// refs - transform state
  const transformRef = useRef<TransformState>(transform);
  const rotationStartRef = useRef<number | null>(null);
  const scaleStartRef = useRef<number | null>(null);

  //// refs - tool selection
  const activeToolRef = useRef<Tool>("NONE");
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);
  const hoverConsumedRef = useRef(false);
  const wasPinchingRef = useRef(false);

  // keep transformRef in sync with state
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  //// tool selection logic
  /**
   * determines which tool button is currently being hovered over
   */
  const getHoveredTool = useCallback(
    (pos: Position, isPinching: boolean): Tool => {
      if (isPinching) return "NONE";

      if (isPointInElement(pos, moveBtnRef.current, containerRef.current)) return "MOVE";
      else if (isPointInElement(pos, rotateBtnRef.current, containerRef.current)) return "ROTATE";
      else if (isPointInElement(pos, scaleBtnRef.current, containerRef.current)) return "SCALE";
      
      return "NONE";
    }, []
  );

  /**
   * handles tool selection via dwell time. (hovering)
   */
  const handleToolSelection = useCallback((pos: Position, isPinching: boolean) => {
    const hoveredTool = getHoveredTool(pos, isPinching);
    const now = performance.now();

    if (hoveredTool === "NONE") {
      // not hovering over a button
      hoverToolRef.current = "NONE";
      hoverStartRef.current = null;
      hoverConsumedRef.current = false;
    } else if (hoverToolRef.current !== hoveredTool) {
      // hovering over a new tool
      hoverToolRef.current = hoveredTool;
      hoverStartRef.current = now;
      hoverConsumedRef.current = false;
    } else if (!hoverConsumedRef.current && hoverStartRef.current && now - hoverStartRef.current > DWELL_TIME) {
      // hovering over same button for at least .5 seconds, but not yet toggled
      const newTool = activeToolRef.current == hoveredTool ? "NONE" : hoveredTool;
      activeToolRef.current = newTool;
      setActiveTool(newTool);
      hoverConsumedRef.current = true;
    }
  }, [getHoveredTool]);

  //// tool execution logic
  /**
   * executes the currently active tool based on finger position and pinch state
   */
  const executeActiveTool = useCallback((pos: Position, isPinching: boolean) => {
    const currentTool = activeToolRef.current;

    if (wasPinchingRef.current && !isPinching) {
      rotationStartRef.current = null;
      scaleStartRef.current = null;
    }
    wasPinchingRef.current = isPinching;

    if (!isPinching) return;

    switch (currentTool) {
      case "MOVE":
        setTransform((prev) => ({
          ...prev,
          position: { x: pos.x, y: pos.y },
        }));
        break;

      case "ROTATE": {
        if (rotationStartRef.current === null) {
          rotationStartRef.current = pos.y;
          return;
        }

        const deltaY = pos.y - rotationStartRef.current;
        const newRotation = transformRef.current.rotation + deltaY * ROTATION_SPEED;

        setTransform((prev) => ({
          ...prev,
          rotation: newRotation,
        }));
        break;
      }

      case "SCALE": {
        if (scaleStartRef.current === null) {
          scaleStartRef.current = pos.x;
          return;
        }

        const deltaX = pos.x - scaleStartRef.current;
        const newScale = clamp(
          transformRef.current.scale + deltaX * SCALE_SPEED, 
          MIN_SCALE,
          MAX_SCALE
        );

        setTransform((prev) => ({
          ...prev,
          scale: newScale,
        }));
        break;
      }
    }
  }, []);

  const handleHandDetected = useCallback(
    (pos: Position, isPinching: boolean) => {
      setFingerPos(pos);
      setPinching(isPinching);
      handleToolSelection(pos, isPinching);
      executeActiveTool(pos, isPinching);
    }, 
    [handleToolSelection, executeActiveTool]
  );

  const handleNoHand = useCallback(() => {
    setFingerPos(null);
    setPinching(false);
    hoverToolRef.current = "NONE";
    hoverStartRef.current = null;
    rotationStartRef.current = null;
    scaleStartRef.current = null;
  }, []);

  const { isInitialized, error } = useHandTracking(
    videoRef,
    containerRef,
    handleHandDetected,
    handleNoHand
  );

  //// render
  return (
    <div className="app-wrapper">
      <div ref={containerRef} className="video-container">
        <video ref={videoRef} autoPlay playsInline />
        <img
          src={shirtImage}
          className="shirt"
          style={{
            left: transform.position.x,
            top: transform.position.y,
            transform: `
              translate(-50%, -50%)
              rotate(${transform.rotation}deg)
              scale(${transform.scale})
            `,
            border: isPinching ? "2px solid lime" : "none"
          }}
          draggable={false}
        />

        {fingerPos && (
          <div
            style={{
              position: "absolute",
              left: fingerPos.x,
              top: fingerPos.y,
              width: CURSOR_SIZE,
              height: CURSOR_SIZE,
              borderRadius: "50%",
              background: isPinching? "lime" : "red",
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

        {/* Loading State */}
        {!isInitialized && !error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            fontSize: '20px'
          }}>
            Initializing camera...
          </div>
        )}

        {/* Error State */}
        {error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
            color: '#ff4444',
            fontSize: '20px',
            textAlign: 'center',
            padding: '20px'
          }}>
            <div>
              <div style={{ marginBottom: '10px' }}>Camera Error</div>
              <div style={{ fontSize: '14px' }}>{error}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App