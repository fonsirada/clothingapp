import { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from "@mediapipe/hands";
import { Pose } from "@mediapipe/pose";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';

//// constants
const DWELL_TIME = 500;
const ROTATION_SPEED = 0.01;
const SCALE_SPEED = 0.0001;
const MIN_SCALE = 0.005;
const MAX_SCALE = 2.5;
const PINCH_THRESHOLD = 0.05;
const CURSOR_SIZE = 14;

const HANDS_CONFIG = {
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
  selfieMode: true
};

const POSE_CONFIG = {
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
};

const CAMERA_CONFIG = {
  width: 1280,
  height: 720
};

//// types
type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";
type Mode = "HAND" | "BODY";

interface Position {
  x: number;
  y: number;
}

interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

interface ClothingItem {
  id: string;
  url: string;
  position: Position;
  rotation: number;
  scale: number;
  name: string;
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
 * checks if a point is within a clothing item's bound
 */
function isPointInItem(point: Position, item: ClothingItem): boolean {
  const itemSize = 200 * item.scale;
  const halfSize = itemSize / 2;
  return (
    point.x >= item.position.x - halfSize &&
    point.x <= item.position.x + halfSize && 
    point.y >= item.position.y - halfSize && 
    point.y <= item.position.y + halfSize
  );
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

// hand & body tracking hook
function useTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  mode: Mode,
  onHandDetected: (fingerPos: Position, isPinching: boolean) => void,
  onNoHand: () => void,
  onPoseDetected: (landmarks: any) => void,
  onNoPose: () => void
) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    let hands: Hands | null = null;
    let pose: Pose | null = null;
    let camera: Camera | null = null;

    const initializeTracking = async() => {
      try {
        // initialize hands tracking
        hands = new Hands({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions(HANDS_CONFIG);
        
        hands.onResults((results) => {
          if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            // no hands detected
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

        // initialize body tracking
        pose = new Pose({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });
        pose.setOptions(POSE_CONFIG);

        pose.onResults((results) => {
          // no body detected
          if (!results.poseLandmarks) {
            onNoPose();
            return;
          }
          onPoseDetected(results.poseLandmarks);
        });

        // send camera frames
        camera = new Camera(videoRef.current!, {
          onFrame: async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              if (mode == "HAND") {
                await hands!.send({ image: videoRef.current! });
              } else {
                await pose!.send({ image: videoRef.current! });
              }
            }
          },
          width: CAMERA_CONFIG.width,
          height: CAMERA_CONFIG.height,
        });

        await camera.start();
        setIsInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize tracking");
        console.error("Tracking initialization error:", err);
      }
    };
    
    initializeTracking();
    return () => {
      camera?.stop();
      hands?.close();
      pose?.close();
    };
  }, [videoRef, containerRef, mode, onHandDetected, onNoHand, onPoseDetected, onNoPose]);

  return { isInitialized, error };
}

//// main component
function App() {
  //// states
  const [clothingItems, setClothingItems] = useState<ClothingItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [fingerPos, setFingerPos] = useState<Position | null>(null);
  const [isPinching, setPinching] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("NONE");
  const [showUpload, setShowUpload] = useState(false);
  const [bodyLandmarks, setBodyLandmarks] = useState<any>(null);
  const [mode, setMode] = useState<Mode>("HAND");

  //// refs - dom elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLDivElement>(null);
  const rotateBtnRef = useRef<HTMLDivElement>(null);
  const scaleBtnRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  //// refs - transform state
  const selectedItemRef = useRef<ClothingItem | null>(null);
  const rotationStartRef = useRef<number | null>(null);
  const scaleStartRef = useRef<number | null>(null);

  //// refs - tool selection
  const activeToolRef = useRef<Tool>("NONE");
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);
  const hoverConsumedRef = useRef(false);
  const wasPinchingRef = useRef(false);

  // keep selecteditemRef in sync with state
  useEffect(() => {
    if (selectedItemId) {
      const item = clothingItems.find(i => i.id === selectedItemId);
      selectedItemRef.current = item || null;
    } else {
      selectedItemRef.current = null;
    }
  }, [selectedItemId, clothingItems]);

  //// file upload handler
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string;
      const newItem: ClothingItem = {
        id: `item-${Date.now()}`,
        url: imageUrl,
        position: { x: 200, y: 200 },
        rotation: 0,
        scale: 1,
        name: file.name,
      };
      setClothingItems(prev => [...prev, newItem]);
      setShowUpload(false);
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  //// item selection logic
  const selectItemAtPosition = useCallback((pos: Position) => {
    for (let i = clothingItems.length - 1; i >= 0; i--) {
      if (isPointInItem(pos, clothingItems[i])) {
        setSelectedItemId(clothingItems[i].id);
        return;
      }
    }
    setSelectedItemId(null);
  }, [clothingItems]);

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
   * handles tool selection via hovering
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

    if (!wasPinchingRef.current && isPinching && currentTool === "NONE") {
      selectItemAtPosition(pos);
    }
    wasPinchingRef.current = isPinching;

    if (!isPinching || !selectedItemRef.current) return;

    const selectedItem = selectedItemRef.current;

    switch (currentTool) {
      case "MOVE":
        setClothingItems(prev =>
          prev.map(item =>
            item.id === selectedItem.id ? { ...item, position: { x: pos.x, y: pos.y } } : item)
        );
        break;

      case "ROTATE": {
        if (rotationStartRef.current === null) {
          rotationStartRef.current = pos.y;
          return;
        }

        const deltaY = pos.y - rotationStartRef.current;
        const newRotation = selectedItem.rotation + deltaY * ROTATION_SPEED;

        setClothingItems(prev =>
          prev.map(item =>
            item.id === selectedItem.id ? { ...item, rotation: newRotation } : item)
          );
        break;
      }

      case "SCALE": {
        if (scaleStartRef.current === null) {
          scaleStartRef.current = pos.x;
          return;
        }

        const deltaX = pos.x - scaleStartRef.current;
        const newScale = clamp(
          selectedItem.scale + deltaX * SCALE_SPEED, 
          MIN_SCALE,
          MAX_SCALE
        );

        setClothingItems(prev =>
          prev.map(item =>
            item.id === selectedItem.id ? {...item, scale: newScale } : item)
          );
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

  const handlePoseDetected = useCallback((landmarks: any) => {
    setBodyLandmarks(landmarks);
  }, []);

  const handleNoPose = useCallback(() => {
    setBodyLandmarks(null);
  }, []);

  const { isInitialized, error } = useTracking(
    videoRef,
    containerRef,
    mode,
    handleHandDetected,
    handleNoHand,
    handlePoseDetected,
    handleNoPose
  );

  //// render
  return (
    <div className="app-wrapper">
      <div ref={containerRef} className="video-container">
        <video ref={videoRef} autoPlay playsInline />

        {/* Render clothing items */}
        {clothingItems.map(item => (
          <img
            key={item.id}
            src={item.url}
            className="clothing-item"
            style={{
              position: "absolute",
              left: item.position.x,
              top: item.position.y,
              transform: `
                translate(-50%, -50%)
                rotate(${item.rotation}deg)
                scale(${item.scale})
              `,
            }}
            draggable={false}
            />
        ))}

        {/* Finger cursor */}
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

        {/* Body landmarks */}
        {bodyLandmarks && containerRef.current && mode === "BODY" && (
          <>
            {bodyLandmarks.map((landmark: any, index: number) => {
              const containerRect = containerRef.current!.getBoundingClientRect();
              const x = landmark.x * containerRect.width;
              const y = landmark.y * containerRect.height;

              return (
                <div
                  key={index}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "cyan",
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                    zIndex: 5
                  }}
                />
              );
            })}
          </>
        )}

        {/* Toolbar */}
        <div className="toolbar">
          <div ref={moveBtnRef} className={`tool ${activeTool === "MOVE" ? "active" : ""}`}>MOVE</div>
          <div ref={rotateBtnRef} className={`tool ${activeTool === "ROTATE" ? "active" : ""}`}>ROTATE</div>
          <div ref={scaleBtnRef} className={`tool ${activeTool === "SCALE" ? "active" : ""}`}>SCALE</div>
        </div>

        {/* Mode toggle button */}
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === "HAND" ? "active" : ""}`}
            onClick={() => setMode("HAND")}
          >
            Hand Mode
          </button>
          <button
            className={`mode-btn ${mode === "BODY" ? "active" : ""}`}
            onClick={() => setMode("BODY")}
          >
            Body Mode
          </button>
        </div>

        {/* Upload button */}
        <div className="upload-controls">
          <button
            className="upload-btn"
            onClick={() => setShowUpload(!showUpload)}
          >
            Add Item
          </button>
          {showUpload && (
            <div className="upload-panel">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                className="upload-option"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload from Device
              </button>
            </div>
          )}
        </div>

        {/* Items list */}
        {clothingItems.length > 0 && (
          <div className="items-list">
            <div className="items-header">Items: ({clothingItems.length})</div>
            {clothingItems.map(item => (
              <div
                key={item.id}
                className={`item-card ${selectedItemId === item.id ? "selected" : ""}`}
                onClick={() => setSelectedItemId(item.id)}
              >
                <img src={item.url} alt={item.name}/>
                <span>{item.name.slice(0, 15)}</span>
              </div>
            ))}
          </div>
        )}

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