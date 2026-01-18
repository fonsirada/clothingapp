import { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from "@mediapipe/hands";
import { Pose } from "@mediapipe/pose";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';

import BLACK_TSHIRT from "./assets/black-shirt.png";
import WHITE_TSHIRT from "./assets/white-shirt.png";

// plan:
// - choose a clothing item (shirt, color) -> display the shirt side-by-side camera
// - upload a design (logo) -> display logo on top of shirt
// - adjust design using hands/mouse? (have presets -> left chest/ right chest/ center chest)
// - create a new image with the design placed onto the shirt and display it on camera with user
// - snap the clothing item to follow the user (try-on phase)

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

const TEMPLATES: Template[] = [
  {
    id: "tshirt-black",
    url: BLACK_TSHIRT,
    name: "Black T-Shirt"
  },
  {
    id: "tshirt-white",
    url: WHITE_TSHIRT,
    name: "White T-Shirt"
  },
  // add more
]

//// types
type Tool = "NONE" | "MOVE" | "ROTATE" | "SCALE";
type Mode = "UPLOAD" | "ADJUST" | "TRYON_HAND" | "TRYON_BODY";

interface Position {
  x: number;
  y: number;
}

interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

interface Template {
  id: string;
  url: string;
  name: string;
}

interface Design {
  url: string;
  name: string;
  position: Position;
  rotation: number;
  scale: number;
}

interface CompositeImage {
  url: string;
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

// /**
//  * checks if a point is within a clothing item's bound
//  */
// function isPointInItem(point: Position, item: ClothingItem): boolean {
//   const itemSize = 200 * item.scale;
//   const halfSize = itemSize / 2;
//   return (
//     point.x >= item.position.x - halfSize &&
//     point.x <= item.position.x + halfSize && 
//     point.y >= item.position.y - halfSize && 
//     point.y <= item.position.y + halfSize
//   );
// }

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

/**
 * extract key body points from pose landmarks
 */
function getKeyBodyPoints(landmarks: any, containerRect: DOMRect) {
  return {
    nose: {
      x: containerRect.width - (landmarks[0].x * containerRect.width),
      y: landmarks[0].y * containerRect.height
    },
    leftShoulder: {
      x: containerRect.width - (landmarks[11].x * containerRect.width),
      y: landmarks[11].y * containerRect.height
    },
    rightShoulder: {
      x: containerRect.width - (landmarks[12].x * containerRect.width),
      y: landmarks[12].y * containerRect.height
    },
    leftHip: {
      x: containerRect.width - (landmarks[23].x * containerRect.width),
      y: landmarks[23].y * containerRect.height
    },
    rightHip: {
      x: containerRect.width - (landmarks[24].x * containerRect.width),
      y: landmarks[24].y * containerRect.height
    }
  };
}

/**
 * calculate body measurements for clothing placement
 */
function calculateBodyMeasurements(keyPoints: ReturnType<typeof getKeyBodyPoints>) {
  const { leftShoulder, rightShoulder, leftHip, rightHip } = keyPoints;

  const shoulderWidth = Math.hypot(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y
  );

  const chestCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2
  };

  const shoulderAngle = Math.atan2(
    rightShoulder.y - leftShoulder.y,
    rightShoulder.x - leftShoulder.x
  ) * (180 / Math.PI);

  const torsoHeight = Math.hypot(
    chestCenter.x - (leftHip.x + rightHip.x) / 2,
    chestCenter.y - (leftHip.y = rightHip.y) / 2
  );

  return {
    shoulderWidth,
    chestCenter,
    shoulderAngle,
    torsoHeight
  };
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
              if (mode == "TRYON_BODY") {
                await pose!.send({ image: videoRef.current! });
              } else {
                await hands!.send({ image: videoRef.current! });
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
  }, [videoRef, containerRef, mode]);

  return { isInitialized, error };
}

//// main component
function App() {
  //// states
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [design, setDesign] = useState<Design | null> (null);
  const [compositeImage, setCompositeImage] = useState<CompositeImage | null>(null);
  const [mode, setMode] = useState<Mode>("UPLOAD");

  const [fingerPos, setFingerPos] = useState<Position | null>(null);
  const [isPinching, setPinching] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("NONE");

  const [bodyLandmarks, setBodyLandmarks] = useState<any>(null);
  const [bodyMeasurements, setBodyMeasurements] = useState<any>(null);

  // const [showUpload, setShowUpload] = useState(false);

  //// refs - dom elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wardrobeRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLDivElement>(null);
  const rotateBtnRef = useRef<HTMLDivElement>(null);
  const scaleBtnRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  //// refs - transform state
  const designRef = useRef<Design | null>(null);
  const compositeRef = useRef<CompositeImage | null>(null);
  const rotationStartRef = useRef<number | null>(null);
  const scaleStartRef = useRef<number | null>(null);

  //// refs - body tracking
  const baseShoulderWidthRef = useRef<number | null>(null);
  const smoothedScaleRef = useRef(0);
  const originalScaleRef = useRef(1);

  //// refs - tool selection
  const activeToolRef = useRef<Tool>("NONE");
  const hoverToolRef = useRef<Tool>("NONE");
  const hoverStartRef = useRef<number | null>(null);
  const hoverConsumedRef = useRef(false);
  const wasPinchingRef = useRef(false);

  // sync refs
  useEffect(() => {
    designRef.current = design;
  }, [design]);

  useEffect(() => {
    compositeRef.current = compositeImage;
  }, [compositeImage]);

  //// design upload handler
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string;
      const newDesign: Design = {
        url: imageUrl,
        position: { x: 1100, y: 300 },
        rotation: 0,
        scale: 1,
        name: file.name,
      };
      setDesign(newDesign);
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setMode("ADJUST");
  }, []);

  //// save composite image (template with user design) - fix this
  const handleSaveComposite = useCallback(() => {
    if (!selectedTemplate || !design || !wardrobeRef.current) return;

    // create a canvas to combine template + logo
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const templateImg = new Image();
    const logoImg = new Image();
    templateImg.src = selectedTemplate.url;
    logoImg.src = design.url;

    Promise.all([
      new Promise(resolve => templateImg.onload = resolve),
      new Promise(resolve => logoImg.onload = resolve)
    ]).then(() => {
      canvas.width = templateImg.width;
      canvas.height = templateImg.height;

      // draw template
      ctx.drawImage(templateImg, 0, 0);

      const uiBoxWidth = wardrobeRef.current.offsetWidth * 0.5;
      const uiBoxHeight = wardrobeRef.current.offsetHeight * 0.5;

      const imgRatio = templateImg.width / templateImg.height;
      const boxRatio = uiBoxWidth / uiBoxHeight;

      let actualVisibleWidth = uiBoxWidth;
      let actualVisibleHeight = uiBoxHeight;
      let horizontalGap = 0;
      let verticalGap = 0;

      if (imgRatio > boxRatio) {
        actualVisibleHeight = uiBoxWidth / imgRatio;
        verticalGap = (uiBoxHeight - actualVisibleHeight) / 2;
      } else {
        actualVisibleWidth = uiBoxHeight * imgRatio;
        horizontalGap = (uiBoxWidth - actualVisibleWidth) / 2;
      }
      
      const pxRatio = templateImg.width / actualVisibleWidth;

      const shirtLeftUI = (wardrobeRef.current.offsetWidth * 0.25) + horizontalGap;
      const shirtTopUI = (wardrobeRef.current.offsetHeight * 0.15) + verticalGap;
      const logoLeftUI = wardrobeRef.current.offsetWidth * 0.50;
      const logoTopUI = wardrobeRef.current.offsetHeight * 0.40;

      const offsetX = (logoLeftUI - shirtLeftUI) * pxRatio;
      const offsetY = (logoTopUI - shirtTopUI) * pxRatio;

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.rotate((design.rotation * Math.PI) / 180);
      const drawWidth = logoImg.width * design.scale * pxRatio * (actualVisibleWidth / templateImg.width);
      const drawHeight = logoImg.height * design.scale * pxRatio * (actualVisibleWidth / templateImg.width);
      ctx.drawImage(
        logoImg,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      );
      ctx.restore();

       // save as composite
      const compositeUrl = canvas.toDataURL('image/png');
      setCompositeImage({
        url: compositeUrl,
        position: { x: 400, y: 300 },
        rotation: 0,
        scale: 1,
      });
      
      // switch to try-on mode
      setMode("TRYON_HAND");
    });
  }, [selectedTemplate, design]);

  //// tool selection logic
  /**
   * determines which tool button is currently being hovered over -- will tweak this later (preset design positions)
   */
  const getHoveredTool = useCallback(
    (pos: Position, isPinching: boolean): Tool => {
      if (isPinching) return "NONE";

      const container = containerRef.current;
      if (isPointInElement(pos, moveBtnRef.current, container)) return "MOVE";
      else if (isPointInElement(pos, rotateBtnRef.current, container)) return "ROTATE";
      else if (isPointInElement(pos, scaleBtnRef.current, container)) return "SCALE";
      
      return "NONE";
    }, [mode]
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
   * executes the currently active tool based on finger position and pinch state - alter this only gonna have 1 item at a time
   */
  const executeActiveTool = useCallback((pos: Position, isPinching: boolean) => {
    const currentTool = activeToolRef.current;

    if (wasPinchingRef.current && !isPinching) {
      rotationStartRef.current = null;
      scaleStartRef.current = null;
    }
    wasPinchingRef.current = isPinching;

    if (!isPinching) return;

    // design mode: manipulate logo
    if (mode === "ADJUST" && design) {
      switch (currentTool) {
        case "MOVE":
          setDesign(prev => prev ? { ...prev, position: pos } : null);
          break;

        case "ROTATE": {
          if (rotationStartRef.current === null) {
            rotationStartRef.current = pos.y;
            return;
          }
          const deltaY = pos.y - rotationStartRef.current;
          setDesign(prev => prev ? {
            ...prev,
            rotation: prev.rotation + deltaY * ROTATION_SPEED
          } : null);
          break;
        }

        case "SCALE": {
          if (scaleStartRef.current === null) {
            scaleStartRef.current = pos.x;
            return;
          }

          const deltaX = pos.x - scaleStartRef.current;
          setDesign(prev => prev ? {
            ...prev,
            scale: clamp(prev.scale + deltaX * SCALE_SPEED, MIN_SCALE, MAX_SCALE)
          } : null);
          break;
        }
      }
    }

    if (mode === "TRYON_HAND" && compositeImage) {
      switch (currentTool) {
        case "MOVE":
          setCompositeImage(prev => prev ? { ...prev, position: pos } : null);
          break;

        case "ROTATE": {
          if (rotationStartRef.current === null) {
            rotationStartRef.current = pos.y;
            return;
          }
          const deltaY = pos.y - rotationStartRef.current;
          setCompositeImage(prev => prev ? {
            ...prev,
            rotation: prev.rotation + deltaY * ROTATION_SPEED
          } : null);
          break;
        }

        case "SCALE": {
          if (scaleStartRef.current === null) {
            scaleStartRef.current = pos.x;
            return;
          }

          const deltaX = pos.x - scaleStartRef.current;
          setCompositeImage(prev => prev ? {
            ...prev,
            scale: clamp(prev.scale + deltaX * SCALE_SPEED, MIN_SCALE, MAX_SCALE)
          } : null);
          break;
        }
      }
    }
  }, [mode, design, compositeImage]);

  //// hand tracking callbacks
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

  // body tracking callbacks
  const handlePoseDetected = useCallback((landmarks: any) => {
    setBodyLandmarks(landmarks);

    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const keyPoints = getKeyBodyPoints(landmarks, containerRect);
      const measurements = calculateBodyMeasurements(keyPoints);
      setBodyMeasurements(measurements);
    }
  }, []);

  const handleNoPose = useCallback(() => {
    setBodyLandmarks(null);
  }, []);

  //// capturing base shoulder width when entering body mode
  useEffect(() => {
    if (mode === "TRYON_BODY" && bodyMeasurements && baseShoulderWidthRef.current === null) {
      baseShoulderWidthRef.current = bodyMeasurements.shoulderWidth;
      
      if (compositeImage) {
        originalScaleRef.current = compositeImage.scale;
        smoothedScaleRef.current = compositeImage.scale;
      }
    }

    if (mode !== "TRYON_BODY") {
      baseShoulderWidthRef.current = null;
    }
  }, [mode, bodyMeasurements, compositeImage]);

  //// auto-position clothing item on body
  useEffect(() => {
    if (mode === "TRYON_BODY" && bodyMeasurements && compositeImage) {
        const scaleFactor = clamp(bodyMeasurements.shoulderWidth / baseShoulderWidthRef.current, 0.5, 3.0);
        const targetScale = originalScaleRef.current * scaleFactor;

        smoothedScaleRef.current = smoothedScaleRef.current + (targetScale - smoothedScaleRef.current) * 0.2;

        // change this to only change the selected item (only gonna be 1 at a time now)
        setCompositeImage(prev => prev ? {
          ...prev,
          position: {
            x: bodyMeasurements.chestCenter.x,
            y: bodyMeasurements.chestCenter.y + 100
          },
          rotation: bodyMeasurements.shoulderAngle,
          scale: smoothedScaleRef.current
        } : null);
    }
  }, [mode, bodyMeasurements, compositeImage]);

  const { isInitialized, error } = useTracking(
    videoRef,
    containerRef,
    mode,
    handleHandDetected,
    handleNoHand,
    handlePoseDetected,
    handleNoPose
  );

  const renderToolbar = (mode: Mode) => {
    switch (mode) {
      case "ADJUST":
        // display templates if one not chosen
        if (!selectedTemplate) return (
          <div className="items-row">
          {TEMPLATES.map(item => (
            <div
              key={item.id}
              className={`item-card ${selectedTemplate?.id === item.id ? "selected" : ""}`}
              onClick={() => selectedTemplate?.id === item.id ? setSelectedTemplate(null) : setSelectedTemplate(item)}
            >
              <img src={item.url} alt={item.name} />
              <span>{item.name}</span>
            </div>
          ))}
          </div>
        )
        // otherwise display appropriate tools
        return (
          <>
            <div className="toolbar top">
              <div ref={rotateBtnRef} className={`tool ${activeTool === "ROTATE" ? "active" : ""}`}>ROTATE</div>
              <div ref={scaleBtnRef} className={`tool ${activeTool === "SCALE" ? "active" : ""}`}>SCALE</div>
            </div>
            <div className="toolbar bottom">
              <button className="tool template-btn" onClick={() => {setSelectedTemplate(null); setMode("ADJUST")}}>
                Switch Template
              </button>
              <button className="tool save-btn" onClick={handleSaveComposite}>Try on</button>
            </div>
          </>
        );

      case "TRYON_HAND":
        return (
          <>
            <div className="toolbar top">
              <div ref={moveBtnRef} className={`tool ${activeTool === "MOVE" ? "active" : ""}`}>MOVE</div>
              <div ref={rotateBtnRef} className={`tool ${activeTool === "ROTATE" ? "active" : ""}`}>ROTATE</div>
              <div ref={scaleBtnRef} className={`tool ${activeTool === "SCALE" ? "active" : ""}`}>SCALE</div>
            </div>
            <div className="toolbar bottom">
              <button className="tool template-btn" onClick={() => {setSelectedTemplate(null); setMode("ADJUST")}}>Switch Template</button>
              <button className="tool" onClick={() => setMode("TRYON_BODY")}>Snap to Body (Full Screen)</button>
            </div>
          </>
        );
      case "TRYON_BODY":
        return (
          <>
            <div className="toolbar bottom">
              <button className="tool template-btn" onClick={() => {setSelectedTemplate(null); setMode("ADJUST")}}>Switch Template</button>
              <button className="tool" onClick={() => setMode("TRYON_HAND")}>Release Snap</button>
            </div>
          </>
        );
    }
  };

  //// render
  return (
    <div className="app-wrapper">

      {/* VIDEO / TRYON VIEW -- only on after uploading a design */}
      {mode !== "UPLOAD" && (
        <div ref={containerRef} className="content-box video-container">
          <video ref={videoRef} autoPlay playsInline />

          {/* Composite image on camera */}
          {compositeImage && (
            <img
              src={compositeImage.url}
              style={{
                position: "absolute",
                left: compositeImage.position.x,
                top: compositeImage.position.y,
                transform: `
                  translate(-50%, -50%)
                  rotate(${compositeImage.rotation}deg)
                  scale(${compositeImage.scale})
                `,
                maxWidth: "500px",
                pointerEvents: "none",
              }}
              draggable={false}
            />
          )}

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
          
          {/* ---- TOOLBAR ---- */}
          {renderToolbar(mode)}
        </div>
      )}

      {/* WARDROBE / DESIGN VIEW */}
      <div ref={wardrobeRef} className="content-box wardrobe-container">
        {/* upload & save button */}
        <div className="design-buttons" style={{ bottom : (mode === "UPLOAD") ? "50%" : "0" }}>
          {/* upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            className="design-btn upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            {design ? "Change Design" : "Upload Design"}
          </button>
        </div>

        {/* template preview */}
        {selectedTemplate && (
          <img
            src={selectedTemplate.url}
            style={{
              position: "absolute",
              left: "25%",
              top: "15%",
              width: "50%",
              height: "50%",
              objectFit: "contain",
            }}
            draggable={false}
          />
        )}

        {/* design on shirt */}
        {design && (
          <img
            src={design.url}
            style={{
              position: "absolute",
              left: "50%",
              top: "40%",
              transform: `
                translate(-50%, -50%)
                rotate(${design.rotation}deg)
                scale(${design.scale})
              `,
              maxWidth: "300px",
              pointerEvents: "none",
              border: isPinching ? "2px solid lime" : "none",
            }}
            draggable={false}
          />
        )}  
      </div>
    </div>
  );
}

export default App