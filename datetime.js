export function updateDateTime(locale) {
    const now = new Date();

    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' };
    const formattedDate = now.toLocaleDateString(locale, dateOptions);

    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formattedTime = now.toLocaleTimeString(locale, timeOptions);

    document.getElementById('currentDate').textContent = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
    document.getElementById('currentTime').textContent = formattedTime;
}

export function showDateTime() {
    document.getElementsByClassName('datetime-container')[0].classList.remove('hidden');
}

export function pauseDateTimeAnimation() {
    //document.getElementsByClassName('datetime-container')[0].classList.remove('hidden');
    document.getElementsByClassName('datetime-container')[0].classList.add('paused');
}

export function resumeDateTimeAnimation() {
    //document.getElementsByClassName('datetime-container')[0].classList.remove('hidden');
    document.getElementsByClassName('datetime-container')[0].classList.remove('paused');
}

export function setFront(){
    document.getElementsByClassName('datetime-container')[0].classList.add('front');
}

export function showDRL(){
    let drl_element = document.getElementsByClassName('drl-container')[0];
    drl_element.classList.remove('hidden');
    // Randomize duration (10-30s)
    let duration = Math.floor(Math.random() * 21000) + 10000;
    setTimeout(() => {
        drl_element.classList.add('hidden');
    }, duration);
}

function toggleAnimation(element, dur_base) {
    element.classList.remove('appear-disappear-1', 'appear-disappear-2');

    void element.offsetWidth; // Critical browser reflow trigger

    const nextClass = Math.random() < 0.5 
    ? 'appear-disappear-1' 
    : 'appear-disappear-2';

    element.classList.add(nextClass);
    // set randomize datetime animation duration

    let dur = `${dur_base}s`

    element.style.setProperty('--dur', dur);

    if (nextClass == 'appear-disappear-1') {
        //console.log(`Zooming in animation. Remove front now. Waiting ${dur_base * 0.5}s`)
        element.classList.remove('front'); // Immediate removal (0%)
        setTimeout(() => {
            //console.log(`Zooming in animation. Add front`)
            element.classList.add('front');
        }, dur_base * 0.5 * 1000);
    } else {
        //console.log(`Zooming out animation. Add front now. Waiting ${dur_base * 0.5}s`)
        element.classList.add('front'); // Immediate addition (0%)
        setTimeout(() => {
            //console.log(`Zooming out animation. Remove front`)
            element.classList.remove('front');
        }, dur_base * 0.5 * 1000);
    }
}


function getActiveAnimations(element) {

    const computedStyle = window.getComputedStyle(element);
    const animations = [];
    
    // Get all active animations
    
    for (let i = 0; i < element.getAnimations().length; i++) {

        const anim = element.getAnimations()[i];
        if (anim.playState === 'running') {
            animations.push(anim);
        }
    }
    
    return animations.length > 0;
}

export function checkContainerMaxSize() {
  let element = document.getElementsByClassName('datetime-container')[0];
  // do hidden datetime-container max size calc
  cont_width = element.getBoundingClientRect().width;
  cont_height = element.getBoundingClientRect().height;
  //console.log(`datetime-container size: ${ cont_width }x${cont_height}`)
}

export function randomizePosition(bounds, src_bounds, dur_base) {
    let element = document.getElementsByClassName('datetime-container')[0];

    // Check if animation is already running
    if (getActiveAnimations(element)) {
        //console.log("Animation is currently running. Skip new run!");
        return; // Skip if animation is active
    }

    let { left, top } = getRandomPosition(bounds, src_bounds);


    /*if (Math.random() > 0.5) {
        element.classList.toggle('front');
    }*/

    element.style.top = top;
    element.style.left = left;
    toggleAnimation(element, dur_base);

}

let lastPosition = { left: 0, top: 0 };
let cont_width;
let cont_height;

function getRandomPosition(bounds, src_bounds) {
  const padding_w = 0; // % w padding
  const padding_h = 0.15; // % h padding
  let w;
  let h;
  let x;
  let y;
  let display;
  let display_id;

  if (Array.isArray(src_bounds) && src_bounds.length > 0) {
    display_id = Math.floor(Math.random() * src_bounds.length);
    display = src_bounds[display_id];
    w = display.width;
    h = display.height;
    x = display.x;
    y = display.y;
  } else {
    x = 0;
    y = 0;
    w = bounds.width;
    h = bounds.height;
  }
  
  const minDistance = 0.5 * Math.min(w, h);
  let distance;
  
  let left, top;
  let attempt = 0;
  let pad_diff;

  do {

    
    left = Math.round(Math.random() * (w * (1 - 2 * padding_w)) + x);
    //left = 600
    top = Math.round(Math.random() * (h * (1 - 2 * padding_h)) + y);
    
    const dx = left - lastPosition.left ;
    const dy = top - lastPosition.top;
    distance = Math.sqrt(dx * dx + dy * dy);

    pad_diff = w*(1 - 2 * padding_w) + x - left // px difference between generated left and display width multiplied by padding+x offset

    /*console.log(`Chosen display id: ${display_id}`)
    console.log(display)
    console.log(`cont_width: ${cont_width/1.8}`)
    console.log(`Random 'left' range: ${x} - ${(w * (1 - 2 * padding_w))+x}`)
    console.log(`px difference between generated left and display + x offset: ${pad_diff} `)
    console.log(`left: ${left}, top: ${top}`)*/
      
  // 1.8 - from style.css we scaling datetime container by 1.8 multiplier
  } while ( ((distance < minDistance) && (top < h * padding_h)) || (pad_diff <= cont_width/1.8 ) || (left <= x));
  
  lastPosition = { left, top };

  return { left, top };
}