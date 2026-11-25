import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Delivery, DeliveryLocation, OperationsState, PackageSize, VehicleType } from '../domain/model'
import { coordinateDistanceKm, estimatePartnerEarnings } from '../domain/estimates'
import { Button, ConfirmDialog, Dialog, EmptyState, Icon, Panel, StatusBadge, formatDate } from '../components/ui'
import { userCan } from '../domain/admin'
import { hasPartnerAccepted } from '../domain/operations'
import { useOperations } from '../state/OperationsProvider'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { useLiveDeliveries } from '../hooks/useLiveDeliveries'
import { MapPreview } from '../components/MapPreview'
import { hasServiceAreaCoordinate, serviceAreaCoordinate } from '../domain/serviceAreas'

const statusFilters = ['All', 'Pending', 'Unassigned', 'Assigned', 'In Transit', 'Delayed', 'Completed', 'Cancelled']
type SortKey = 'priority' | 'scheduledStart' | 'id' | 'status' | 'pickup'
type LocationLookup = 'idle' | 'searching' | 'choose' | 'found' | 'invalid' | 'error'
interface LocationSuggestion {
  display_name: string
  lat: string
  lon: string
}

interface Props {
  data: OperationsState
  open: (path: string) => void
  statusFromUrl?: string
  initialSearch?: string
}

function localInputValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function DeliveryFormDialog({ delivery, onClose }: { delivery?: Delivery; onClose: () => void }) {
  const { dispatch } = useOperations()
  const editing = Boolean(delivery)
  // Legacy console deliveries may only have an area name. Reuse the same
  // service-area coordinate fallback as the assignment/map logic so editing
  // them does not require re-selecting a location.
  const initialPickupLocation = delivery
    ? delivery.pickupLocation ?? (delivery.pickup && hasServiceAreaCoordinate(delivery.pickup) ? serviceAreaCoordinate(delivery.pickup) : null)
    : null
  const initialDropLocation = delivery
    ? delivery.dropLocation ?? (delivery.drop && hasServiceAreaCoordinate(delivery.drop) ? serviceAreaCoordinate(delivery.drop) : null)
    : null
  const [pickup, setPickup] = useState(delivery?.pickup ?? '')
  const [drop, setDrop] = useState(delivery?.drop ?? '')
  const [locationMode, setLocationMode] = useState<'pickup' | 'drop'>('pickup')
  const [pickupLocation, setPickupLocation] = useState<DeliveryLocation | null>(initialPickupLocation)
  const [dropLocation, setDropLocation] = useState<DeliveryLocation | null>(initialDropLocation)
  const [pickupLookup, setPickupLookup] = useState<LocationLookup>(initialPickupLocation ? 'found' : delivery ? 'invalid' : 'idle')
  const [dropLookup, setDropLookup] = useState<LocationLookup>(initialDropLocation ? 'found' : delivery ? 'invalid' : 'idle')
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([])
  const [dropSuggestions, setDropSuggestions] = useState<LocationSuggestion[]>([])
  const [mapFocusKey, setMapFocusKey] = useState(0)
  const pickupFieldRef = useRef<HTMLDivElement>(null)
  const dropFieldRef = useRef<HTMLDivElement>(null)
  const pickupSkipLookup = useRef(initialPickupLocation ? delivery?.pickup ?? '' : '')
  const dropSkipLookup = useRef(initialDropLocation ? delivery?.drop ?? '' : '')
  const pickupResultsRef = useRef<LocationSuggestion[]>([])
  const dropResultsRef = useRef<LocationSuggestion[]>([])
  const pickupRequestRef = useRef(0)
  const dropRequestRef = useRef(0)
  const [category, setCategory] = useState<Delivery['category']>(delivery?.category ?? 'Grocery')
  const [packageSize, setPackageSize] = useState<PackageSize>(delivery?.packageSize ?? 'Small')
  const [weight, setWeight] = useState(delivery ? String(delivery.estimatedWeightKg) : '2')
  const [itemCount, setItemCount] = useState(delivery?.itemCount != null ? String(delivery.itemCount) : '1')
  const [paymentMode, setPaymentMode] = useState<Delivery['paymentMode']>(delivery?.paymentMode ?? 'Prepaid')
  const [customerName, setCustomerName] = useState(delivery?.customerName ?? '')
  const [customerPhone, setCustomerPhone] = useState(delivery?.customerPhone ?? '')
  const [orderValue, setOrderValue] = useState(delivery?.orderValue != null ? String(delivery.orderValue) : '')
  const [collectAmount, setCollectAmount] = useState(delivery?.collectAmount != null ? String(delivery.collectAmount) : '')
  const [earnings, setEarnings] = useState(delivery?.partnerEarnings != null ? String(delivery.partnerEarnings) : '')
  const [vehicle, setVehicle] = useState<VehicleType | 'Any'>(delivery?.vehicleRequirement ?? 'Any')
  const [start, setStart] = useState(() => localInputValue(delivery ? new Date(delivery.scheduledStart) : new Date(Date.now() + 60 * 60_000)))
  const [end, setEnd] = useState(() => localInputValue(delivery ? new Date(delivery.scheduledEnd) : new Date(Date.now() + 3 * 60 * 60_000)))
  const [instructions, setInstructions] = useState(
    delivery?.specialInstructions && delivery.specialInstructions !== 'No special instructions'
      ? delivery.specialInstructions
      : '',
  )
  const suggestedEarnings = pickupLocation && dropLocation
    ? estimatePartnerEarnings(coordinateDistanceKm(pickupLocation, dropLocation))
    : null

  useEffect(() => {
    const query = pickup.trim()
    // Selecting a suggestion or reverse-geocoding a map click fills the input
    // programmatically. Do not immediately erase that choice or refetch it.
    if (query && query === pickupSkipLookup.current) {
      // Keep the guard until the operator edits the text. Clearing it here
      // would make StrictMode's second effect run wipe the loaded location.
      setPickupSuggestions([])
      return
    }
    setPickupLocation(null)
    pickupResultsRef.current = []
    setPickupSuggestions([])
    if (query.length < 3) { setPickupLookup(query ? 'invalid' : 'idle'); return }
    setPickupLookup('searching')
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&viewbox=88.0,22.9,88.7,22.3&q=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Location search failed')
        const results: LocationSuggestion[] = await response.json()
        const next = results.slice(0, 5)
        pickupResultsRef.current = next
        setPickupSuggestions(next)
        // The operator must pick a result; auto-taking the first match can
        // silently choose a same-named place in another city.
        setPickupLookup(next.length ? 'choose' : 'invalid')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPickupLookup('error')
      }
    }, 650)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [pickup])

  useEffect(() => {
    const query = drop.trim()
    if (query && query === dropSkipLookup.current) {
      setDropSuggestions([])
      return
    }
    setDropLocation(null)
    dropResultsRef.current = []
    setDropSuggestions([])
    if (query.length < 3) { setDropLookup(query ? 'invalid' : 'idle'); return }
    setDropLookup('searching')
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&viewbox=88.0,22.9,88.7,22.3&q=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Location search failed')
        const results: LocationSuggestion[] = await response.json()
        const next = results.slice(0, 5)
        dropResultsRef.current = next
        setDropSuggestions(next)
        setDropLookup(next.length ? 'choose' : 'invalid')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDropLookup('error')
      }
    }, 650)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [drop])

  useEffect(() => {
    const closeSuggestions = (event: MouseEvent) => {
      const target = event.target as Node
      if (pickupFieldRef.current && !pickupFieldRef.current.contains(target)) setPickupSuggestions([])
      if (dropFieldRef.current && !dropFieldRef.current.contains(target)) setDropSuggestions([])
    }
    document.addEventListener('mousedown', closeSuggestions)
    return () => document.removeEventListener('mousedown', closeSuggestions)
  }, [])

  async function reverseLabel(location: DeliveryLocation) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.latitude}&lon=${location.longitude}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!response.ok) return null
      const payload: unknown = await response.json()
      if (payload && typeof payload === 'object' && 'display_name' in payload) {
        const displayName = (payload as { display_name?: unknown }).display_name
        if (typeof displayName === 'string' && displayName.trim()) return displayName.trim().slice(0, 120)
      }
      return null
    } catch {
      return null
    }
  }

  async function placeFromMap(mode: 'pickup' | 'drop', location: DeliveryLocation) {
    const requestRef = mode === 'pickup' ? pickupRequestRef : dropRequestRef
    const request = requestRef.current + 1
    requestRef.current = request
    if (mode === 'pickup') {
      setPickupLocation(location)
      setPickupSuggestions([])
      pickupResultsRef.current = []
      setPickupLookup('searching')
    } else {
      setDropLocation(location)
      setDropSuggestions([])
      dropResultsRef.current = []
      setDropLookup('searching')
    }

    const label = (await reverseLabel(location))
      ?? `Map pin ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
    // A second click or typing while the address resolves wins.
    if (request !== requestRef.current) return

    if (mode === 'pickup') {
      pickupSkipLookup.current = label
      setPickup(label)
      setPickupLookup('found')
    } else {
      dropSkipLookup.current = label
      setDrop(label)
      setDropLookup('found')
    }
  }

  function selectSuggestion(mode: 'pickup' | 'drop', suggestion: LocationSuggestion) {
    const latitude = Number(suggestion.lat)
    const longitude = Number(suggestion.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    const label = suggestion.display_name.trim().slice(0, 120)
    if (mode === 'pickup') {
      pickupSkipLookup.current = label
      pickupRequestRef.current += 1
      setPickup(label)
      setPickupLocation({ latitude, longitude })
      pickupResultsRef.current = []
      setPickupSuggestions([])
      setPickupLookup('found')
    } else {
      dropSkipLookup.current = label
      dropRequestRef.current += 1
      setDrop(label)
      setDropLocation({ latitude, longitude })
      dropResultsRef.current = []
      setDropSuggestions([])
      setDropLookup('found')
    }
    setLocationMode(mode)
    setMapFocusKey((value) => value + 1)
  }

  function changeLocationText(mode: 'pickup' | 'drop', value: string) {
    if (mode === 'pickup') {
      pickupRequestRef.current += 1
      pickupSkipLookup.current = ''
      setPickup(value)
    } else {
      dropRequestRef.current += 1
      dropSkipLookup.current = ''
      setDrop(value)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pickupLocation || !dropLocation) return
    const details = {
      pickup,
      drop,
      pickupLocation: pickupLocation ?? undefined,
      dropLocation: dropLocation ?? undefined,
      packageSize,
      weight: Number(weight),
      vehicle,
      scheduledStart: new Date(start).toISOString(),
      scheduledEnd: new Date(end).toISOString(),
      instructions,
      category,
      itemCount: Number(itemCount),
      paymentMode,
      earnings: earnings.trim() ? Number(earnings) : null,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      orderValue: orderValue.trim() ? Number(orderValue) : null,
      collectAmount: collectAmount.trim() ? Number(collectAmount) : null,
    }
    if (delivery) {
      dispatch({ type: 'delivery.update', deliveryId: delivery.id, ...details })
    } else {
      dispatch({ type: 'delivery.create', ...details })
    }
    onClose()
  }

  const locationsReady = Boolean(pickupLocation && dropLocation)
  const activeLocation = locationMode === 'pickup' ? pickupLocation : dropLocation
  const activeAddress = locationMode === 'pickup' ? pickup : drop
  const lookupMessage = (label: string, state: LocationLookup) => state === 'searching' ? `Finding ${label.toLowerCase()}…` : state === 'choose' ? `Select a matching ${label.toLowerCase()} location.` : state === 'invalid' ? `Enter a valid ${label.toLowerCase()} location.` : state === 'error' ? `Could not verify the ${label.toLowerCase()} location. Try again.` : state === 'found' ? `${label} verified` : `Select a ${label.toLowerCase()} location.`

  return <Dialog title={editing ? `Edit delivery ${delivery?.id}` : 'Create a delivery'} onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">{editing
        ? 'Updates the shared delivery details. If an offer is already published, the pickup, drop, customer, package, schedule, and payout are updated in delivery_app before partner acceptance.'
        : 'Creates the job in the console. Assigning it publishes an offer to the linked partner app in Firestore; no customer is contacted.'}</p>
      <div className="form-grid two-columns">
        <div className="field-label location-field" ref={pickupFieldRef}>
          <label htmlFor="delivery-pickup-area">Pickup area</label>
          <div className="location-input-wrap">
            <input
              id="delivery-pickup-area"
              autoFocus
              value={pickup}
              onChange={(event) => changeLocationText('pickup', event.target.value)}
              onFocus={() => { if (pickupLookup === 'choose' && pickupResultsRef.current.length) setPickupSuggestions(pickupResultsRef.current) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && pickupSuggestions.length) {
                  event.stopPropagation()
                  setPickupSuggestions([])
                } else if (event.key === 'Enter' && pickupSuggestions.length) {
                  event.preventDefault()
                  selectSuggestion('pickup', pickupSuggestions[0])
                }
              }}
              required
              maxLength={120}
              placeholder="e.g. Barasat"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={pickupSuggestions.length > 0}
              aria-controls="delivery-pickup-suggestions"
            />
            {pickupSuggestions.length > 0 && <div className="location-suggestions" id="delivery-pickup-suggestions" role="listbox" aria-label="Pickup location suggestions" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setPickupSuggestions([]) } }}>
              {pickupSuggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={false} key={`${suggestion.lat}-${suggestion.lon}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion('pickup', suggestion)}>{suggestion.display_name}</button>)}
            </div>}
          </div>
          <small className={`location-validation location-${pickupLookup}`}>{lookupMessage('Pickup', pickupLookup)}</small>
        </div>
        <div className="field-label location-field" ref={dropFieldRef}>
          <label htmlFor="delivery-drop-area">Drop area</label>
          <div className="location-input-wrap">
            <input
              id="delivery-drop-area"
              value={drop}
              onChange={(event) => changeLocationText('drop', event.target.value)}
              onFocus={() => { if (dropLookup === 'choose' && dropResultsRef.current.length) setDropSuggestions(dropResultsRef.current) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && dropSuggestions.length) {
                  event.stopPropagation()
                  setDropSuggestions([])
                } else if (event.key === 'Enter' && dropSuggestions.length) {
                  event.preventDefault()
                  selectSuggestion('drop', dropSuggestions[0])
                }
              }}
              required
              maxLength={120}
              placeholder="e.g. New Town"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={dropSuggestions.length > 0}
              aria-controls="delivery-drop-suggestions"
            />
            {dropSuggestions.length > 0 && <div className="location-suggestions" id="delivery-drop-suggestions" role="listbox" aria-label="Drop location suggestions" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setDropSuggestions([]) } }}>
              {dropSuggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={false} key={`${suggestion.lat}-${suggestion.lon}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion('drop', suggestion)}>{suggestion.display_name}</button>)}
            </div>}
          </div>
          <small className={`location-validation location-${dropLookup}`}>{lookupMessage('Drop', dropLookup)}</small>
        </div>
        <div className="delivery-location-picker span-two">
          <div className="location-picker-header"><div><strong>Stop locations</strong><span>Choose a stop, then drag the map, scroll to zoom, and click to place the pin. You can also drag the pin.</span></div></div>
          <div className="location-picker-tabs"><button type="button" className={locationMode === 'pickup' ? 'active' : ''} onClick={() => { setLocationMode('pickup'); setMapFocusKey((value) => value + 1) }}>Pickup {pickupLocation ? '✓' : ''}</button><button type="button" className={locationMode === 'drop' ? 'active' : ''} onClick={() => { setLocationMode('drop'); setMapFocusKey((value) => value + 1) }}>Drop {dropLocation ? '✓' : ''}</button></div>
          <section className="location-current-section" aria-label="Current location">
            <div className="location-current-heading">
              <div>
                <strong>Current location</strong>
                <span>{locationMode === 'pickup' ? 'Pickup' : 'Drop'}{activeLocation ? ` · ${activeAddress || 'Selected on map'}` : ' · Not selected'}</span>
              </div>
              {activeLocation && <span className="location-current-coordinates">{activeLocation.latitude.toFixed(5)}, {activeLocation.longitude.toFixed(5)}</span>}
            </div>
            <MapPreview
              ariaLabel={`Current ${locationMode} location map`}
              className="delivery-location-map"
              recenterKey={mapFocusKey}
              points={[{
                id: 'location-center',
                label: locationMode === 'pickup' ? (pickupLocation ? 'Pickup' : 'Click to set pickup') : (dropLocation ? 'Drop' : 'Click to set drop'),
                ...(locationMode === 'pickup' ? pickupLocation ?? serviceAreaCoordinate(pickup || 'Kolkata') : dropLocation ?? serviceAreaCoordinate(drop || 'Kolkata')),
                kind: locationMode === 'pickup' ? 'pickup' : 'drop',
              }]}
              onMapClick={(location) => { void placeFromMap(locationMode, location) }}
            />
          </section>
          <small className="field-help">{pickupLocation ? `Pickup: ${pickupLocation.latitude.toFixed(5)}, ${pickupLocation.longitude.toFixed(5)}` : 'Pickup location not selected.'} · {dropLocation ? `Drop: ${dropLocation.latitude.toFixed(5)}, ${dropLocation.longitude.toFixed(5)}` : 'Drop location not selected.'}</small>
        </div>
        <label className="field-label">Category<select value={category} onChange={(event) => setCategory(event.target.value as Delivery['category'])}><option>Grocery</option><option>Restaurant</option></select></label>
        <label className="field-label">Package size<select value={packageSize} onChange={(event) => setPackageSize(event.target.value as PackageSize)}><option>Small</option><option>Medium</option><option>Large</option><option>Extra large</option></select></label>
        <label className="field-label">Estimated weight (kg)<input type="number" min="0.1" max="100" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} required /></label>
        <label className="field-label">Item count<input type="number" min="1" max="99" step="1" value={itemCount} onChange={(event) => setItemCount(event.target.value)} required /></label>
        <label className="field-label">Payment mode<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as Delivery['paymentMode'])}><option>Prepaid</option><option>Cash on delivery</option></select></label>
        <label className="field-label">Customer name<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Name shared with the partner" /></label>
        <label className="field-label">Customer phone<input inputMode="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="10-digit contact number" /></label>
        <label className="field-label">Order value (₹)<input type="number" min="0" step="1" value={orderValue} onChange={(event) => setOrderValue(event.target.value)} placeholder="e.g. 450" /></label>
        <label className="field-label">COD amount to collect (₹)<input type="number" min="0" step="1" value={collectAmount} onChange={(event) => setCollectAmount(event.target.value)} placeholder="Leave blank for prepaid" /></label>
        <label className="field-label">Partner payout (₹)<input type="number" min="0" step="1" value={earnings} onChange={(event) => setEarnings(event.target.value)} placeholder={suggestedEarnings ? `Suggested ₹${suggestedEarnings}` : 'e.g. 95'} /></label>
        <label className="field-label">Vehicle requirement<select value={vehicle} onChange={(event) => setVehicle(event.target.value as VehicleType | 'Any')}><option>Any</option><option>Bike</option><option>Scooter</option><option>Van</option><option>Bicycle</option><option>On foot</option></select></label>
        <label className="field-label">Pickup / delivery window start<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
        <label className="field-label">Delivery window end<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
        <label className="field-label span-two">Special instructions<textarea rows={2} maxLength={180} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional handling note" /></label>
      </div>
  <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!locationsReady}><Icon name={editing ? 'edit' : 'plus'} size={15} />{editing ? 'Save changes' : 'Create delivery'}</Button></div>
    </form>
  </Dialog>
}

function DeliveryRowMenu({ deliveryId, children }: { deliveryId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      const menu = document.getElementById(`delivery-menu-${deliveryId}`)
      if (menu?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const closeForViewport = () => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', closeForViewport)
    window.addEventListener('scroll', closeForViewport, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', closeForViewport)
      window.removeEventListener('scroll', closeForViewport, true)
    }
  }, [open, deliveryId])

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 188
    setPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 160),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    })
    setOpen(true)
  }

  return <>
    <button ref={triggerRef} className={`row-menu-trigger ${open ? 'open' : ''}`} onClick={toggle} aria-label={`Actions for ${deliveryId}`} aria-haspopup="menu" aria-expanded={open}><Icon name="more" size={18} /></button>
    {open && position && createPortal(
      <div id={`delivery-menu-${deliveryId}`} className="row-menu-popover" role="menu" style={{ position: 'fixed', top: position.top, left: position.left }} onClick={() => setOpen(false)}>{children}</div>,
      document.body,
    )}
  </>
}

function partnerFor(data: OperationsState, delivery: Delivery) {
  const assignment = data.assignments.find((item) => item.id === delivery.assignmentId)
  return assignment ? data.partners.find((partner) => partner.id === assignment.partnerId) : undefined
}

export function DeliveriesPage({ data, open, statusFromUrl, initialSearch = '' }: Props) {
  const { frame, dispatch } = useOperations()
  const live = useLiveDeliveries(frame.data.partnerApp, hasFirebaseAdminSession())
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState(statusFilters.includes(statusFromUrl ?? '') ? statusFromUrl! : 'All')
  const [pickup, setPickup] = useState('All')
  const [drop, setDrop] = useState('All')
  const [partner, setPartner] = useState('All')
  const [vehicle, setVehicle] = useState('All')
  const [packageSize, setPackageSize] = useState('All')
  const [scheduledDate, setScheduledDate] = useState('')
  const [assignmentState, setAssignmentState] = useState('All')
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [ascending, setAscending] = useState(true)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Delivery | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Delivery | null>(null)
  const pageSize = 8
  const areas = [...new Set(data.deliveries.flatMap((delivery) => [delivery.pickup, delivery.drop]))].sort()
  const assignedPartners = [...new Map(data.assignments.map((assignment) => {
    const currentPartner = data.partners.find((item) => item.id === assignment.partnerId)
    return currentPartner ? [currentPartner.id, currentPartner] as const : null
  }).filter((item): item is readonly [string, OperationsState['partners'][number]] => Boolean(item)))].map(([, item]) => item)

  const filtered = useMemo(() => data.deliveries.filter((delivery) => {
    const currentPartner = partnerFor(data, delivery)
    const query = search.trim().toLowerCase()
    const text = [delivery.id, delivery.pickup, delivery.drop, delivery.pickupAddress, delivery.dropAddress, currentPartner?.name ?? '', currentPartner?.id ?? ''].join(' ').toLowerCase()
    const date = new Date(delivery.scheduledStart).toISOString().slice(0, 10)
    return (!query || text.includes(query))
      && (status === 'All' || delivery.status === status)
      && (pickup === 'All' || delivery.pickup === pickup)
      && (drop === 'All' || delivery.drop === drop)
      && (partner === 'All' || currentPartner?.id === partner)
      && (vehicle === 'All' || delivery.vehicleRequirement === vehicle)
      && (packageSize === 'All' || delivery.packageSize === packageSize)
      && (!scheduledDate || date === scheduledDate)
      && (assignmentState === 'All' || (assignmentState === 'Assigned' ? Boolean(delivery.assignmentId && delivery.status !== 'Cancelled') : !delivery.assignmentId))
  }).sort((a, b) => {
    if (sortKey === 'priority') {
      const priorities = ['Delayed', 'Unassigned', 'Pending', 'Assigned', 'In Transit', 'Completed', 'Cancelled']
      const priority = priorities.indexOf(a.status) - priorities.indexOf(b.status)
      if (priority) return priority
      return a.scheduledStart.localeCompare(b.scheduledStart)
    }
    const left = sortKey === 'scheduledStart' ? a.scheduledStart : sortKey === 'id' ? a.id : sortKey === 'status' ? a.status : a.pickup
    const right = sortKey === 'scheduledStart' ? b.scheduledStart : sortKey === 'id' ? b.id : sortKey === 'status' ? b.status : b.pickup
    const comparison = left.localeCompare(right)
    return ascending ? comparison : -comparison
  }), [data, search, status, pickup, drop, partner, vehicle, packageSize, scheduledDate, assignmentState, sortKey, ascending])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const selectedVisible = visible.length > 0 && visible.every((delivery) => selected.includes(delivery.id))
  const canAssign = userCan(frame.data.user, 'assignment')
  const canCreate = userCan(frame.data.user, 'delivery-management')

  useEffect(() => { setSearch(initialSearch); setPage(1) }, [initialSearch])
  useEffect(() => { if (statusFilters.includes(statusFromUrl ?? '')) setStatus(statusFromUrl!); else setStatus('All') }, [statusFromUrl])

  function resetFilters() {
    setSearch(''); setStatus('All'); setPickup('All'); setDrop('All'); setPartner('All'); setVehicle('All'); setPackageSize('All'); setScheduledDate(''); setAssignmentState('All'); setPage(1)
  }

  function changeSort(next: SortKey) {
    if (sortKey === next) setAscending((value) => !value)
    else { setSortKey(next); setAscending(true) }
  }

  function toggleVisible() {
    if (selectedVisible) setSelected((value) => value.filter((id) => !visible.some((delivery) => delivery.id === id)))
    else setSelected((value) => [...new Set([...value, ...visible.map((delivery) => delivery.id)])])
  }

  function bulkAssign() {
    const delivery = data.deliveries.find((item) => selected.includes(item.id) && !['Completed', 'Cancelled'].includes(item.status))
    if (delivery) open(`/admin/deliveries/${delivery.id}/assign`)
  }

  return <div className="page-stack">
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>delivery records</span><span className="dot-separator" />{data.deliveries.length} total</div><div className="records-actions">{selected.length > 0 && <Button size="small" variant="secondary" onClick={bulkAssign} disabled={!canAssign}><Icon name="route" size={14} />Assign first selected{selected.length > 1 ? ` (${selected.length} selected)` : ''}</Button>}<Button size="small" variant="primary" onClick={() => setCreateOpen(true)} disabled={!canCreate} title={canCreate ? undefined : 'Delivery management access required'}><Icon name="plus" size={15} />Create delivery</Button></div></div>
      <div className="filter-toolbar">
        <label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search ID, location, or partner" aria-label="Search deliveries" /></label>
        <label className="filter-control"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>{statusFilters.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Pickup</span><select value={pickup} onChange={(event) => { setPickup(event.target.value); setPage(1) }}><option>All</option>{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
        <label className="filter-control"><span>Drop</span><select value={drop} onChange={(event) => { setDrop(event.target.value); setPage(1) }}><option>All</option>{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
        <label className="filter-control"><span>Partner</span><select value={partner} onChange={(event) => { setPartner(event.target.value); setPage(1) }}><option>All</option>{assignedPartners.map((item) => <option value={item.id} key={item.id}>{item.id} · {item.name}</option>)}</select></label>
        <label className="filter-control"><span>Vehicle</span><select value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPage(1) }}><option>All</option><option>Any</option><option>Bike</option><option>Scooter</option><option>Van</option><option>Bicycle</option><option>On foot</option></select></label>
        <label className="filter-control"><span>Package</span><select value={packageSize} onChange={(event) => { setPackageSize(event.target.value); setPage(1) }}><option>All</option><option>Small</option><option>Medium</option><option>Large</option><option>Extra large</option></select></label>
        <label className="filter-control filter-date"><span>Scheduled date</span><input type="date" value={scheduledDate} onChange={(event) => { setScheduledDate(event.target.value); setPage(1) }} /></label>
        <label className="filter-control"><span>Assignment</span><select value={assignmentState} onChange={(event) => { setAssignmentState(event.target.value); setPage(1) }}><option>All</option><option>Assigned</option><option>Unassigned</option></select></label>
        <Button size="small" variant="quiet" onClick={resetFilters}><Icon name="refresh" size={14} />Reset</Button>
      </div>

      {selected.length > 0 && <div className="selection-banner"><span>{selected.length} selected</span><button onClick={() => setSelected([])}>Clear selection</button><small>Bulk assignment opens the first eligible delivery selected.</small></div>}
      <div className="table-scroll">
        <table className="data-table delivery-table">
          <thead><tr>
            <th className="select-cell"><input type="checkbox" checked={selectedVisible} onChange={toggleVisible} aria-label="Select visible deliveries" /></th>
            <th><button className="sort-button" onClick={() => changeSort('id')}>Delivery ID <Icon name="sort" size={13} /></button></th>
            <th><button className="sort-button" onClick={() => changeSort('pickup')}>Pickup → drop <Icon name="sort" size={13} /></button></th>
            <th>Package</th><th><button className="sort-button" onClick={() => changeSort('scheduledStart')}>Scheduled window <Icon name="sort" size={13} /></button></th><th>Assigned partner</th><th><button className="sort-button" onClick={() => changeSort('status')}>Status <Icon name="sort" size={13} /></button></th><th>Assignment</th><th>Exception</th><th aria-label="Actions" />
          </tr></thead>
          <tbody>{visible.map((delivery) => {
            const assigned = partnerFor(data, delivery)
            const isAssigned = Boolean(delivery.assignmentId && delivery.status !== 'Cancelled')
            const liveDelivery = live.deliveries.find((item) => item.id === delivery.id || item.displayId.replace(/^#/, '') === delivery.id)
            // A live document is authoritative. With no live document, only
            // an active assignment can be accepted; an unassigned delivery
            // must keep its menu actions enabled.
            const partnerAccepted = hasPartnerAccepted(delivery, liveDelivery?.nativeStatus, isAssigned)
            const canRemoveAssignment = Boolean(assigned && isAssigned && !partnerAccepted && canAssign)
            const editBlockedByPublication = Boolean(isAssigned && (delivery.publicationStatus === 'Pending' || delivery.publicationStatus === 'Failed'))
            return <tr key={delivery.id}>
              <td className="select-cell"><input type="checkbox" checked={selected.includes(delivery.id)} onChange={() => setSelected((value) => value.includes(delivery.id) ? value.filter((id) => id !== delivery.id) : [...value, delivery.id])} aria-label={`Select ${delivery.id}`} /></td>
              <td><button className="record-id" onClick={() => open(`/admin/deliveries/${delivery.id}`)}>{delivery.id}</button><small className="cell-subtext">{formatDate(delivery.createdAt, { month: 'short', day: 'numeric' })}</small></td>
              <td><span className="route-cell">{delivery.pickup}<Icon name="arrow" size={13} />{delivery.drop}</span><small className="cell-subtext">{delivery.vehicleRequirement === 'Any' ? 'Any vehicle' : `${delivery.vehicleRequirement} required`}</small></td>
              <td><strong className="package-value">{delivery.packageSize}</strong><small className="cell-subtext">{delivery.estimatedWeightKg > 0 ? `${delivery.estimatedWeightKg.toFixed(1)} kg` : 'Weight not provided'}</small></td>
              <td><strong className="window-value">{formatDate(delivery.scheduledStart, { hour: 'numeric', minute: '2-digit' })} – {formatDate(delivery.scheduledEnd, { hour: 'numeric', minute: '2-digit' })}</strong><small className="cell-subtext">{formatDate(delivery.scheduledStart, { month: 'short', day: 'numeric' })}</small></td>
              <td>{assigned ? <button className="partner-link" onClick={() => open(`/admin/partners/${assigned.id}`)}><span className="mini-avatar">{assigned.name.split(' ').map((part) => part[0]).join('').replace('.', '')}</span><span><b>{assigned.name}</b><small>{assigned.id}</small></span></button> : <span className="unassigned-cell">Unassigned</span>}</td>
              <td><StatusBadge status={delivery.status} />{delivery.publicationStatus && delivery.publicationStatus !== 'Published' && <small className={`publish-state publish-${delivery.publicationStatus.toLowerCase().replace(/\s+/g, '-')}`}>{delivery.publicationStatus}</small>}</td>
              <td><span className={`assignment-chip ${isAssigned ? 'assignment-active' : ''}`}><i />{isAssigned ? delivery.status === 'Completed' ? 'Completed' : 'Assigned' : 'Unassigned'}</span></td>
              <td>{delivery.status === 'Delayed' ? <span className="exception-text" title={delivery.delayReason ?? 'Review needed'}><Icon name="alert" size={14} />Delayed</span> : delivery.status === 'Cancelled' ? <span className="muted-text">—</span> : <span className="muted-text">—</span>}</td>
              <td><DeliveryRowMenu deliveryId={delivery.id}><button onClick={() => open(`/admin/deliveries/${delivery.id}`)}>View details</button>{delivery.status !== 'Completed' && delivery.status !== 'Cancelled' && <button disabled={!canCreate || partnerAccepted || editBlockedByPublication} title={partnerAccepted ? 'The partner has accepted this delivery; details are locked.' : !canCreate ? 'Delivery management access required.' : editBlockedByPublication ? 'Wait for the partner app publish to finish, or retry/remove the failed offer, before editing.' : 'Edit pickup, drop, customer, package, schedule, and payout details'} onClick={() => setEditTarget(delivery)}>Edit delivery</button>}{delivery.status !== 'Completed' && delivery.status !== 'Cancelled' && <button disabled={!canAssign || partnerAccepted} title={partnerAccepted ? 'The partner has accepted this delivery; reassignment is blocked.' : undefined} onClick={() => open(`/admin/deliveries/${delivery.id}/assign`)}>{isAssigned ? 'Reassign partner' : 'Assign partner'}</button>}{isAssigned && <button disabled={!canRemoveAssignment} title={partnerAccepted ? 'The partner has accepted or started this delivery.' : !canAssign ? 'Assignment management access required.' : 'Remove the partner before acceptance'} onClick={() => setRemoveTarget(delivery)}>Remove partner</button>}{partnerAccepted && <span className="row-menu-note">Accepted by partner · actions locked</span>}</DeliveryRowMenu></td>
            </tr>
          })}</tbody>
        </table>
        {visible.length === 0 && <EmptyState title="No deliveries match these filters" detail="Change the search or reset filters to see the delivery queue." />}
      </div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div>
    </Panel>
    {createOpen && <DeliveryFormDialog key="create" onClose={() => setCreateOpen(false)} />}
    {editTarget && <DeliveryFormDialog key={editTarget.id} delivery={editTarget} onClose={() => setEditTarget(null)} />}
    {removeTarget && <ConfirmDialog
      title={`Remove ${partnerFor(data, removeTarget)?.name ?? 'the partner'} from ${removeTarget.id}?`}
      detail="The partner is removed before acceptance, the delivery returns to Unassigned, and the offer is withdrawn from delivery_app. The assignment remains in history."
      reasonLabel="Removal reason"
      confirmLabel="Remove partner"
      danger
      onCancel={() => setRemoveTarget(null)}
      onConfirm={(reason) => {
        dispatch({ type: 'delivery.unassign', deliveryId: removeTarget.id, reason: reason.trim() || 'Removed by administrator before partner acceptance.' })
        setRemoveTarget(null)
      }}
    />}
  </div>
}
