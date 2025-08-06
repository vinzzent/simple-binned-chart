// #region IMPORTS

// Imports D3 modules, Power BI visual API, and utility helpers for tooltips, formatting, and chart settings
import * as d3 from "d3";
import {
    BaseType,
    select as d3Select,
} from "d3-selection";

import powerbi from "powerbi-visuals-api";
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter, textMeasurementService as tms } from "powerbi-visuals-utils-formattingutils";
import { BinnedChartSettingsModel } from "./binnedChartSettingsModel";

// Imports the visual's custom styles from a LESS stylesheet
import "./../style/visual.less";

// Imports Power BI visual interfaces and types used for visual construction, updates, interactivity, and events
import IVisual = powerbi.extensibility.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualEventService = powerbi.extensibility.IVisualEventService;

// #endregion

// #region DEFINITIONS

// Defines a type alias for the return type of valueFormatter.create
type Formatter = ReturnType<typeof valueFormatter.create>;

// Defines optional margins with required top and left values
interface Margins {
    top: number;
    right?: number;
    bottom?: number;
    left: number;
}

// Interface for pairing original data points before binning
interface PreBinnedDataPoint {
    binValue: number;
    measureValue: number;
    countValue: number;
    tooltipValue: any;
    selectionId: ISelectionId;
}

// Interface for the final binned data points
export interface BinnedDataPoint extends d3.Bin<PreBinnedDataPoint, number> {
    aggregatedValue: number;
    selectionIds: ISelectionId[];
    tooltips: VisualTooltipDataItem[];
    color: string;
}

// Represents the possible UI states of the visual
enum VisualState {
    Landing,
    Error,
    Chart
}

// Defines the main BinnedChart visual class and its internal state, elements, services, and data bindings
export class BinnedChart implements IVisual {
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private host: IVisualHost;
    private barContainer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private xAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
    private yAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
    private dataLabelsContainer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private curve: d3.Selection<SVGPathElement, unknown, null, undefined>;
    private curveMarkersContainer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private customXAxisLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: BinnedChartSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private tooltipServiceWrapper: ITooltipServiceWrapper;
    private selectionManager: ISelectionManager;
    private isLandingPageOn: boolean = false;
    private LandingPage: d3.Selection<any, any, any, any>;
    private element: HTMLElement;
    private events: IVisualEventService;
    private categories?: powerbi.DataViewCategoryColumn;
    private values?: powerbi.DataViewValueColumn;
    private countMeasure?: powerbi.DataViewValueColumn;
    private tooltipData?: powerbi.DataViewValueColumn;
    private formatters?: {
        forCategory: Formatter,
        forMeasure: Formatter,
        forExtraTooltip: Formatter,
    };

    // Defines static configuration values for layout, opacity, and scaling
    static Config = {
        solidOpacity: 1,
        transparentOpacity: 0.4,
        margins: { top: 30, right: 30, bottom: 30, left: 75, },
        labelCharHeight: 10,
        yMaxMultiplier: 1.1,
    };

    // #endregion

    // #region CONTRUCTOR

    // Initializes the visual: sets up SVG elements, accessibility, tooltip, selection, formatting, and visibility observer
    constructor(options: VisualConstructorOptions) {
        this.element = options.element;
        this.host = options.host;
        this.events = options.host.eventService;
        this.element.setAttribute('tabindex', '0');
        this.svg = d3Select(this.element).append("svg").classed("binnedBarChart", true);
        this.xAxis = this.svg.append("g").classed("xAxis", true);
        this.yAxis = this.svg.append("g").classed("yAxis", true);
        this.dataLabelsContainer = this.svg.append("g").classed("dataLabelsContainer", true);
        this.curve = this.svg.append("path").classed("normal-curve", true);
        this.curveMarkersContainer = this.svg.append("g").classed("curveMarkersContainer", true);
        this.customXAxisLabels = this.svg.append("g").classed("customXAxisLabels", true);
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipServiceWrapper = createTooltipServiceWrapper(this.host.tooltipService, this.element);
        const localizationManager = this.host.createLocalizationManager();
        this.formattingSettingsService = new FormattingSettingsService(localizationManager);
        this.barContainer = this.svg.append("g").classed("barContainer", true).attr("role", "list");
        this.handleContextMenu();
    }

    // ##endregion

    // #region UPDATE

    // processes new data and viewport settings to determine the visual's state (landing, error, or chart), renders accordingly, and notifies Power BI of rendering events.    
    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        const dataView = options.dataViews[0];

        const width = options.viewport.width;
        const height = options.viewport.height;
        this.svg.attr("width", width).attr("height", height);

        // STATE DETERMINATION: This block determines the single state for the visual based on the dataView.
        let currentState: VisualState;
        let validationMessage: string = "";

        const categorical = dataView?.categorical;
        this.categories = categorical?.categories?.[0];
        this.values = categorical?.values?.find(val => val.source.roles?.measure);
        this.countMeasure = categorical?.values?.find(val => val.source.roles?.countMeasure);
        this.tooltipData = categorical?.values?.find(val => val.source.roles?.tooltips);

        const hasCategories = !!this.categories;
        const hasValues = !!this.values;
        const hasCountMeasure = !!this.countMeasure;
        const isCategoryNumeric = this.categories?.source.type.numeric === true;


        if (!hasCategories && !hasValues && !hasCountMeasure) {
            currentState = VisualState.Landing;
        } else if (!hasCategories || !isCategoryNumeric) {
            currentState = VisualState.Error;
            validationMessage = "'Field to bin' must be a numeric field.";
        } else if (!hasValues) {
            currentState = VisualState.Error;
            validationMessage = "'Value' must be a numeric measure.";
        } else if (!hasCountMeasure) {
            currentState = VisualState.Error;
            validationMessage = "'Frequency measure' must be a numeric measure.";
        } else {
            currentState = VisualState.Chart;
        }

        // STATE RENDERER: This switch statement acts on the determined state, ensuring only one rendering path is executed.
        switch (currentState) {
            case VisualState.Landing:
                this.svg.classed("hidden", true);
                this.clearVisual();
                this.showLandingPage();
                break;

            case VisualState.Error:
                this.svg.classed("hidden", false);
                this.hideLandingPage();
                this.clearVisual();
                this.displayValidationError(validationMessage);
                break;

            case VisualState.Chart:
                this.svg.classed("hidden", false);
                this.hideLandingPage();
                this.svg.select(".validation-error").remove();
                this.formatters = {
                    forCategory: valueFormatter.create({
                        format: this.categories?.source.format,
                    }),
                    forMeasure: valueFormatter.create({
                        format: this.values?.source.format,
                    }),
                    forExtraTooltip: valueFormatter.create({
                        format: this.tooltipData?.source.format,
                    }),
                };

                this.renderChart(dataView, width, height);
                break;
        }

        this.events.renderingFinished(options);
    }

    // #endregion

    // #region RENDER CHART: SETUP & DATA EXTRACTION

    // Transforms data, sets scales, and renders binned histogram with bars, axes, labels, and optional curve.
    private renderChart(dataView: powerbi.DataView, width: number, height: number) {
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(BinnedChartSettingsModel, dataView);
        this.formattingSettings.isTooltipDataPresent = !!this.tooltipData;
        this.formattingSettings.updateAllSlices();

        const margins = BinnedChart.Config.margins;

        const preBinnedData: PreBinnedDataPoint[] = [];
        const categories = this.categories;
        const values = this.values;
        const countMeasure = this.countMeasure;
        const tooltipData = this.tooltipData;

        for (let i = 0; i < categories.values.length; i++) {
            const binValue = categories.values[i] as number;
            const measureValue = values.values[i] as number;
            const countValue = countMeasure.values[i] as number;
            if (typeof binValue === 'number' && typeof measureValue === 'number') {
                preBinnedData.push({
                    binValue,
                    measureValue,
                    countValue,
                    tooltipValue: tooltipData ? tooltipData.values[i] : null,
                    selectionId: this.host.createSelectionIdBuilder().withCategory(categories, i).createSelectionId()
                });
            }
        }

        // This check handles cases where data is valid but insufficient to draw a chart.
        if (preBinnedData.length < 1) {
            this.clearVisual();
            return; // Use return to exit the function.
        }

        // #endregion

        // #region RENDER CHART: BIDDING LOGIC & SCALES

        const dataDomain: [number, number] = [
            d3.min(preBinnedData, d => d.binValue) as number,
            d3.max(preBinnedData, d => d.binValue) as number
        ];

        // --- Step 1: Initialize binning parameters and constants
        const binMode = this.formattingSettings.bins.binMode.value;
        const [minDomain, maxDomain] = dataDomain; // Use destructuring for clarity
        let numBins: number;
        let binSize: number;

        // --- Define constants for clarity and easy maintenance ---
        const MAX_BINS = 1000;
        const DEFAULT_FALLBACK_BINS = 10;
        const domainRange = maxDomain - minDomain;

        // --- Step 2: Calculate bin size based on a user-defined size, a user-defined count, or an automatic count ---   
        switch (binMode) {
            case "automatic": {
                const N = d3.sum(preBinnedData, d => d.countValue);
                // Sturges' formula for a good default number of bins
                numBins = Math.max(1, Math.ceil(Math.log2(N) + 1));
                binSize = domainRange / numBins;
                break;
            }

            case "byCount": {
                numBins = this.formattingSettings.bins.numberOfBins.value;
                // Ensure numBins is at least 1 to avoid division by zero
                if (numBins < 1) {
                    numBins = 1;
                }
                binSize = domainRange / numBins;
                break;
            }

            case "bySize": {
                const userBinSize = this.formattingSettings.bins.binSize.value;
                const isUserBinSizeValid = typeof userBinSize === 'number' && isFinite(userBinSize) && userBinSize > 0;
                const estimatedBins = isUserBinSizeValid ? (domainRange / userBinSize!) : Infinity;

                // Use the user's value if it's valid and results in a reasonable number of bins
                if (isUserBinSizeValid && estimatedBins <= MAX_BINS) {
                    binSize = userBinSize!;
                    numBins = Math.ceil(estimatedBins);
                } else {
                    // Otherwise, fall back to a default bin count
                    numBins = DEFAULT_FALLBACK_BINS;
                    binSize = domainRange / numBins;

                    // Show a warning only if the user provided a number that we had to override
                    if (isUserBinSizeValid) {
                        this.host.displayWarningIcon?.(
                            "Bin size too small",
                            "The bin size you selected is too small. The visual has automatically adjusted to a standard bin size."
                        );
                    }
                }
                break;
            }
            default: {
                // As a safe fallback for any unexpected binMode, use the 'automatic' logic
                console.warn(`Unknown binMode: '${binMode}'. Defaulting to 'automatic'.`);
                const N = d3.sum(preBinnedData, d => d.countValue);
                numBins = Math.max(1, Math.ceil(Math.log2(N) + 1));
                binSize = domainRange / numBins;
                break;
            }
        }

        // --- Step 3: Align domain and recalculate binSize for 'byCount' ---
        // Round the domain outwards to multiples of the binSize for cleaner axes.
        const alignedMin = Math.floor(minDomain / binSize) * binSize;
        const alignedMax = Math.ceil(maxDomain / binSize) * binSize;

        // To ensure the user gets the *exact* number of bins they asked for in 'byCount' and calculate in 'automatic' mode,
        // we recalculate the binSize based on the newly aligned domain.
        if (binMode === "byCount" || binMode === "automatic") {
            binSize = (alignedMax - alignedMin) / numBins!;
        }

        // --- Step 4: Generate thresholds and final "nice" domain ---
        const thresholds = d3.range(alignedMin, alignedMax, binSize);

        // Correct the final boundary to prevent floating-point errors from d3.range excluding the last value.
        const alignedMaxCorrected = thresholds.length > 0
            ? thresholds[thresholds.length - 1] + binSize
            : alignedMin + binSize;

        const niceDomain: [number, number] = [alignedMin, alignedMaxCorrected];

        // --- Step 5: Configure D3 components ---
        const niceXScale = d3.scaleLinear().domain(niceDomain);

        const histogram = d3.bin<PreBinnedDataPoint, number>()
            .value(d => d.binValue)
            .domain(niceDomain)
            .thresholds(thresholds);

        // #endregion

        // #region RENDER CHART: AGGREGATION, TOOLTIPS AND STYLING

        const bins: BinnedDataPoint[] = histogram(preBinnedData).map((bin) => {
            let aggregatedValue: number;
            const valueCalc = this.formattingSettings.bars.valuesCalculation.value;

            if (valueCalc === "weightedAvg") {
                const weightedSum = d3.sum(bin, d => d.measureValue * d.countValue);
                const totalCount = d3.sum(bin, d => d.countValue);

                aggregatedValue = totalCount > 0 ? weightedSum / totalCount : 0;

            } else if (valueCalc === "minimum") {
                aggregatedValue = d3.min(bin, d => d.measureValue) ?? 0;
            } else if (valueCalc === "maximum") {
                aggregatedValue = d3.max(bin, d => d.measureValue) ?? 0;
            } else { // Default to sum
                aggregatedValue = d3.sum(bin, d => d.measureValue);
            }

            const selectionIds = bin.map(d => d.selectionId);

            const binX0 = bin.x0 ?? 0;
            const binX1 = bin.x1 ?? 0;
            const currentBinSize = binX1 - binX0;
            const binRange = `${this.formatters.forCategory.format(binX0)} - ${this.formatters.forCategory.format(binX1)}`;

            const tooltips: VisualTooltipDataItem[] = [
                { displayName: "Bin range", value: binRange },
                { displayName: "Bin size", value: this.formatters.forCategory.format(currentBinSize) },
                { displayName: values.source.displayName, value: this.formatters.forMeasure.format(aggregatedValue) },
            ];

            if (tooltipData) {
                let aggregatedTooltipValue: number;
                const tooltipCalc = this.formattingSettings.bars.tooltipCalculation.value;

                if (tooltipCalc === "weightedAvg") {
                    const weightedSum = d3.sum(bin, d => (d.tooltipValue) * d.countValue);
                    const totalCount = d3.sum(bin, d => d.countValue);

                    aggregatedTooltipValue = totalCount > 0 ? weightedSum / totalCount : 0;

                } else if (tooltipCalc === "minimum") {
                    aggregatedTooltipValue = d3.min(bin, d => d.tooltipValue) ?? 0;
                } else if (tooltipCalc === "maximum") {
                    aggregatedTooltipValue = d3.max(bin, d => d.tooltipValue) ?? 0;
                } else { // Default to sum
                    aggregatedTooltipValue = d3.sum(bin, d => d.tooltipValue);
                }
                tooltips.push({
                    displayName: tooltipData.source.displayName,
                    value: this.formatters.forExtraTooltip.format(aggregatedTooltipValue),
                });
            }

            const color = this.host.colorPalette.isHighContrast
                ? this.host.colorPalette.foreground.value
                : this.formattingSettings.bars.fill.value.value;

            const extendedBin = bin as BinnedDataPoint;
            extendedBin.aggregatedValue = aggregatedValue;
            extendedBin.selectionIds = selectionIds;
            extendedBin.tooltips = tooltips;
            extendedBin.color = color;

            return extendedBin;
        });

        const widthWithMargin = width - margins.left - margins.right;
        const xScale = niceXScale.range([0, widthWithMargin]);
        const { useVerticalLabels, bottomMargin } = this.calculateLabelSettings(bins, xScale);

        const heightWithMargin = height - margins.top - bottomMargin;

        this.barContainer.attr("transform", `translate(${margins.left}, ${margins.top})`);

        const yMax = d3.max(bins, d => d.aggregatedValue) ?? 0;
        const yScaleDomainMax = this.formattingSettings.bars.showBarValues.value ? yMax * BinnedChart.Config.yMaxMultiplier : yMax;
        const yScale = d3.scaleLinear().range([heightWithMargin, 0]).domain([0, yScaleDomainMax]).nice();

        this.renderBars(bins, xScale, yScale, heightWithMargin);

        if (this.formattingSettings.bars.showBarValues.value) {
            this.renderDataLabels(bins, xScale, yScale, values.source.format);
        } else {
            this.dataLabelsContainer.selectAll("*").remove();
        }

        const yAxis = d3.axisLeft(yScale);
        this.yAxis
            .attr("transform", `translate(${margins.left}, ${margins.top})`)
            .call(yAxis);
        const yTickFontSettings = this.formattingSettings.bars.yTickFont;
        this.yAxis.selectAll("text")
            .style("font-family", yTickFontSettings.fontFamily.value)
            .style("font-size", `${yTickFontSettings.fontSize.value}px`)
            .style("font-weight", yTickFontSettings.bold.value ? "bold" : "normal")
            .style("font-style", yTickFontSettings.italic.value ? "italic" : "normal")
            .style("fill", "#333"); // Default color

        if (this.formattingSettings.bins.xAxisLabelsType.value === "tickValue") {
            this.customXAxisLabels.selectAll("*").remove();
            const tickValues = bins.length > 0 ? bins.map(d => d.x0).concat(bins[bins.length - 1].x1 ?? 0) : [];
            const xAxis = d3.axisBottom(xScale).tickValues(tickValues as number[]).tickFormat(d => this.formatters.forCategory.format(d));
            this.xAxis
                .attr("transform", `translate(${margins.left}, ${heightWithMargin + margins.top})`)
                .call(xAxis);
            const xTickFontSettings = this.formattingSettings.bins.binLabelFont;
            this.xAxis.selectAll("text")
                .style("font-family", xTickFontSettings.fontFamily.value)
                .style("font-size", `${xTickFontSettings.fontSize.value}px`)
                .style("font-weight", xTickFontSettings.bold.value ? "bold" : "normal")
                .style("font-style", xTickFontSettings.italic.value ? "italic" : "normal")
                .style("fill", "#333");
        } else {
            this.xAxis.selectAll("*").remove();
            this.renderCustomXAxisLabels(bins, xScale, heightWithMargin + margins.top, useVerticalLabels);
        }

        if (this.formattingSettings.line.showNormalCurve.value) {
            this.renderNormalCurve(preBinnedData, bins, xScale, yScale, margins);
        } else {
            this.curve.attr("d", null);
        }
    }

    // #endregion

    // #region RENDER BARS

    // Binds bins to bars, updates visuals and accessibility, adds tooltips, and enables interaction.
    private renderBars(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, heightWithMargin: number) {
        const bars = this.barContainer.selectAll("rect").data(bins);
        bars.exit().remove();
        const allBars = bars.enter()
            .append("rect")
            .merge(bars as any);

        allBars
            .attr("x", (d: BinnedDataPoint) => xScale(d.x0!) + 1)
            .attr("y", (d: BinnedDataPoint) => yScale(d.aggregatedValue))
            .attr("width", (d: BinnedDataPoint) => Math.max(0, xScale(d.x1!) - xScale(d.x0!) - 1))
            .attr("height", (d: BinnedDataPoint) => heightWithMargin - yScale(d.aggregatedValue))
            .attr("tabindex", 0)
            .attr("role", "listitem")
            .attr("aria-label", (d: BinnedDataPoint) => `Bin from ${this.formatters.forCategory.format(d.x0)} to ${this.formatters.forCategory.format(d.x1)}: value ${this.formatters.forMeasure.format(d.aggregatedValue)}`)
            .style("fill", (d: BinnedDataPoint) => d.color)
            .style("stroke", this.host.colorPalette.isHighContrast ? this.host.colorPalette.background.value : null)
            .style("stroke-width", this.host.colorPalette.isHighContrast ? "2px" : null);

        this.tooltipServiceWrapper.addTooltip(
            allBars,
            (d: BinnedDataPoint) => d.tooltips
        );
        this.setupInteractivity(allBars, bins);
    }

    // #endregion

    // #region SETUP INTERACTIVITY

    // Adds keyboard/mouse handlers for selection, navigation, focus, and clearing selection.
    private setupInteractivity(allBars: d3.Selection<d3.BaseType, BinnedDataPoint, SVGGElement, unknown>, bins: BinnedDataPoint[]) {
        const selectionManager = this.selectionManager;
        const allowInteractions = this.host.hostCapabilities.allowInteractions;

        this.element.onkeydown = (event: KeyboardEvent) => {
            if (!allowInteractions || event.key !== "Enter") {
                return;
            }
            const firstBar = this.barContainer.select("rect").node() as unknown as HTMLElement;
            if (firstBar) {
                firstBar.focus();
            }
            event.preventDefault();
        };

        allBars.on("focus", function () {
            d3.select(this).classed("keyboard-focus", true);
        });

        allBars.on("blur", function () {
            d3.select(this).classed("keyboard-focus", false);
        });

        allBars.on("click", (event: MouseEvent, d: BinnedDataPoint) => {
            if (allowInteractions) {
                selectionManager.select(d.selectionIds, event.ctrlKey).then((ids: ISelectionId[]) => {
                    syncSelectionState(allBars, ids);
                });
                event.stopPropagation();
            }
        });

        allBars.on("keydown", (event: KeyboardEvent, d: BinnedDataPoint) => {
            if (!allowInteractions) return;

            const currentBarIndex = bins.indexOf(d);
            if (currentBarIndex === -1) return; // Safeguard for robustness

            switch (event.key) {
                case "Enter":
                case " ":
                    selectionManager.select(d.selectionIds, event.ctrlKey).then((ids: ISelectionId[]) => {
                        syncSelectionState(allBars, ids);
                    });
                    event.preventDefault();
                    break;
                case "ArrowRight":
                    const nextIndex = (currentBarIndex + 1) % bins.length;
                    (allBars.nodes()[nextIndex] as unknown as HTMLElement).focus();
                    event.preventDefault();
                    break;
                case "ArrowLeft":
                    const prevIndex = (currentBarIndex - 1 + bins.length) % bins.length;
                    (allBars.nodes()[prevIndex] as unknown as HTMLElement).focus();
                    event.preventDefault();
                    break;
                case "Escape":
                    selectionManager.clear();
                    (this.element as HTMLElement).focus();
                    event.preventDefault();
                    break;
            }
        });

        syncSelectionState(allBars, selectionManager.getSelectionIds() as ISelectionId[]);

        this.svg.on("click", () => {
            if (allowInteractions) {
                selectionManager.clear().then(() => {
                    allBars.style("fill-opacity", BinnedChart.Config.solidOpacity);
                });
            }
        });
    }

    // #endregion

    // #region X LABELS SETTINGS

    //Checks if x-axis labels fit horizontally; if not, uses vertical labels and increases bottom margin.
    private calculateLabelSettings(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>) {
        let useVerticalLabels = false;
        let bottomMargin = BinnedChart.Config.margins.bottom;

        const isBinRange = this.formattingSettings.bins.xAxisLabelsType.value === "binRange";
        if (isBinRange) {
            const labels = bins.map(bin => `${this.formatters.forCategory.format(bin.x0)} - ${this.formatters.forCategory.format(bin.x1)}`);

            const horizontalLabelWidths = labels.map(label => tms.measureSvgTextWidth({ text: label, fontFamily: "sans-serif", fontSize: "11px" }));
            const totalHorizontalWidth = d3.sum(horizontalLabelWidths);

            if (totalHorizontalWidth > xScale.range()[1]) {
                useVerticalLabels = true;
            }

            if (useVerticalLabels) {
                const maxVerticalHeight = d3.max(labels, label => (label?.length ?? 0)) * BinnedChart.Config.labelCharHeight * 0.8;
                bottomMargin += maxVerticalHeight
            }
        }
        return { useVerticalLabels, bottomMargin };
    }

    // #endregion

    // #region X LABELS ROTATED

    //Renders styled x-axis bin labels, rotated if vertical.
    private renderCustomXAxisLabels(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, topPosition: number, useVertical: boolean) {
        this.customXAxisLabels.attr("transform", `translate(${BinnedChart.Config.margins.left}, ${topPosition})`);
        const labels = this.customXAxisLabels.selectAll("text").data(bins);

        const customLabelFontSettings = this.formattingSettings.bins.binLabelFont;
        labels.enter()
            .append("text")
            .merge(labels as any)
            .attr("class", "custom-axis-label")
            .attr("text-anchor", useVertical ? "end" : "middle")
            .attr("transform", (d: BinnedDataPoint) => {
                const xPos = xScale(d.x0!) + (xScale(d.x1!) - xScale(d.x0!)) / 2;
                return useVertical ? `translate(${xPos}, 10) rotate(-90)` : `translate(${xPos}, 20)`;
            })
            .text((d: BinnedDataPoint) => `${this.formatters.forCategory.format(d.x0)} - ${this.formatters.forCategory.format(d.x1)}`)
            .style("font-family", customLabelFontSettings.fontFamily.value)
            .style("font-size", `${customLabelFontSettings.fontSize.value}px`)
            .style("font-weight", customLabelFontSettings.bold.value ? "bold" : "normal")
            .style("font-style", customLabelFontSettings.italic.value ? "italic" : "normal")
            .style("fill", "#333");

        labels.exit().remove();
    }

    // #endregion

    // #region RENDER NORMAL CURVE

    // Draws normal curve and markers with tooltips.
    private renderNormalCurve(
        data: PreBinnedDataPoint[],
        bins: BinnedDataPoint[],
        xScale: d3.ScaleLinear<number, number>,
        yScale: d3.ScaleLinear<number, number>,
        margins: Margins
    ) {
        const allBinValues = data.map(d => d.binValue);
        const mean = d3.mean(allBinValues)!;
        const stdDev = d3.deviation(allBinValues)!;

        if (!stdDev) {
            this.curve.attr("d", null);
            this.curveMarkersContainer.selectAll("*").remove();
            return;
        }

        function normalPDF(x: number, mu: number, sigma: number) {
            return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
        }

        const totalAggregatedValue = d3.sum(bins, d => d.aggregatedValue);
        const binWidth = (bins[0].x1 ?? 0) - (bins[0].x0 ?? 0);

        // --- PART 1: Curve Rendering ---
        const curveData = xScale.ticks(100).map(x => ({
            x,
            y: normalPDF(x, mean, stdDev) * totalAggregatedValue * binWidth
        }));

        const line = d3.line<{ x: number, y: number }>()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y));

        this.curve
            .datum(curveData)
            .attr("transform", `translate(${margins.left}, ${margins.top})`)
            .attr("d", line)
            .style("fill", "none")
            .style("stroke", this.formattingSettings.line.curveColor.value.value)
            .style("stroke-width", this.formattingSettings.line.strokeWidth.value);

        this.curve.raise();

        // --- PART 2: Curve Markers at Bin Midpoints ---
        this.curveMarkersContainer.raise();
        this.curveMarkersContainer.attr("transform", `translate(${margins.left}, ${margins.top})`);

        const midpointsData = bins.map(bin => {
            const midpoint = (bin.x0 + bin.x1) / 2;
            return {
                x: midpoint,
                y: normalPDF(midpoint, mean, stdDev) * totalAggregatedValue * binWidth
            };
        });

        const markers = this.curveMarkersContainer.selectAll("circle").data(midpointsData);

        markers.enter()
            .append("circle")
            .merge(markers as any)
            .attr("cx", d => xScale(d.x))
            .attr("cy", d => yScale(d.y))
            .attr("r", 15)
            .style("fill", "transparent");

        this.tooltipServiceWrapper.addTooltip(
            this.curveMarkersContainer.selectAll("circle"),
            (d: { x: number, y: number }) => {
                const midPoint = d.x;
                const expectedValue = d.y;
                return [
                    { displayName: "General Mean", value: this.formatters.forMeasure.format(mean) },
                    { displayName: "General Std Dev", value: this.formatters.forMeasure.format(stdDev) },
                    { displayName: "Bin Midpoint", value: this.formatters.forCategory.format(midPoint) },
                    { displayName: "Fitted Normal Value", value: this.formatters.forMeasure.format(expectedValue) }
                ];
            }
        );

        markers.exit().remove();
    }

    // #endregion

    // #region CONTEXT MENU

    // Handles right-click to show context menu for the clicked data point.
    private handleContextMenu() {
        this.svg.on('contextmenu', (event: MouseEvent) => {
            const eventTarget: EventTarget = event.target;
            const dataPoint = d3.select<BaseType, BinnedDataPoint>(eventTarget as BaseType).datum();
            this.selectionManager.showContextMenu(dataPoint ? dataPoint.selectionIds : {}, {
                x: event.clientX,
                y: event.clientY
            });
            event.preventDefault();
        });
    }

    // #endregion

    // #region VALIDATION ERROR

    // Shows a centered error message inside the SVG with styled text.
    private displayValidationError(message: string) {
        const width = this.element.clientWidth;
        const height = this.element.clientHeight;

        // Append a new text element to the SVG to show the error.
        this.svg.append("text")
            .classed("validation-error", true) // Use a class for easy removal.
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .style("fill", this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : "#777777")
            .text(message);
    }

    // #endregion

    // #region LANDING PAGE CONTROL

    // Displays a landing page once by appending it to the element.
    private showLandingPage() {
        if (!this.isLandingPageOn) {
            this.isLandingPageOn = true;
            const landingPageElement = createLandingPage(this.host);
            this.element.appendChild(landingPageElement);
            this.LandingPage = d3Select(landingPageElement);
        }
    }

    // Hides and removes the landing page, restoring focus if needed.
    private hideLandingPage() {
        if (this.isLandingPageOn) {
            this.isLandingPageOn = false;
            if (this.LandingPage) {
                const landingPageNode = this.LandingPage.node();
                if (landingPageNode && landingPageNode.contains(document.activeElement)) {
                    (this.element as HTMLElement).focus();
                }
                this.LandingPage.remove();
            }
        }
    }

    // #endregion

    // #region CLEAR VISUAL

    // Clears the chart by removing all visual elements and resets focus if needed.
    private clearVisual() {
        const svgNode = this.svg.node();
        if (svgNode && svgNode.contains(document.activeElement)) {
            (this.element as HTMLElement).focus();
        }
        this.svg.select(".validation-error").remove();
        this.barContainer.selectAll("*").remove();
        this.xAxis.selectAll("*").remove();
        this.yAxis.selectAll("*").remove();
        this.customXAxisLabels.selectAll("*").remove();
        this.dataLabelsContainer.selectAll("*").remove();
        this.curve.attr("d", null);
        this.curveMarkersContainer.selectAll("*").remove();
    }

    // #endregion

    // #region DATA LABELS

    // Renders formatted data labels above bars with styling and positioning based on settings.
    private renderDataLabels(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, format: string) {
        const barsSettings = this.formattingSettings.bars;

        this.dataLabelsContainer.attr("transform", `translate(${BinnedChart.Config.margins.left}, ${BinnedChart.Config.margins.top})`);

        const dataLabelFormatter = valueFormatter.create({
            format: format,
            value: barsSettings.labelDisplayUnits.value,
            precision: barsSettings.labelPrecision.value
        });

        const labels = this.dataLabelsContainer.selectAll("text").data(bins);

        labels.enter()
            .append("text")
            .merge(labels as any)
            .attr("x", (d: BinnedDataPoint) => xScale(d.x0!) + (xScale(d.x1!) - xScale(d.x0!)) / 2)
            .attr("y", (d: BinnedDataPoint) => yScale(d.aggregatedValue) - 5)
            .attr("text-anchor", "middle")
            .style("font-family", barsSettings.labelFont.fontFamily.value)
            .style("font-size", `${barsSettings.labelFont.fontSize.value}px`)
            .style("font-weight", barsSettings.labelFont.bold.value ? "bold" : "normal")
            .style("font-style", barsSettings.labelFont.italic.value ? "italic" : "normal")
            .style("fill", this.host.colorPalette.isHighContrast
                ? this.host.colorPalette.foreground.value
                : barsSettings.labelFontColor.value.value
            )
            .text((d: BinnedDataPoint) => dataLabelFormatter.format(d.aggregatedValue));

        labels.exit().remove();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.formattingSettings.bars.tooltipCalculation.visible = this.formattingSettings.isTooltipDataPresent;
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        //return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}

function syncSelectionState(selection: d3.Selection<d3.BaseType, BinnedDataPoint, any, any>, selectionIds: ISelectionId[]): void {
    if (!selection || !selectionIds) {
        return;
    }

    selection.style("fill-opacity", (d: BinnedDataPoint) => {
        const isSelected = d.selectionIds.some(binId => selectionIds.some(selectedId => selectedId.equals(binId)));
        if (selectionIds.length > 0) {
            return isSelected ? BinnedChart.Config.solidOpacity : BinnedChart.Config.transparentOpacity;
        }
        return BinnedChart.Config.solidOpacity;
    });
}

// #endregion

// #region LANDING PAGE

// Returns a div with a logo, titles, instructions, and links for empty data display.
function createLandingPage(host: IVisualHost): Element {
    const div = document.createElement("div");
    div.className = "landingPageContainer";

    // Logo
    const logo = document.createElement("img");
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 800 800"><path d="M27.517 256.55h214.13V786H27.517V256.55zM293.37 36.579H507.5v749.42H293.37V36.579zM558.18 526.13h214.13V786H558.18V526.13z" fill="#77bef0"/><path d="M12 783.3C225.78 563.45 269.92 13.39 403.02 14.83S574.05 567.64 793 777.19" fill="none" stroke="#ff894f" stroke-width="20"/></svg>`;
    logo.src = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
    logo.alt = "Visual logo";
    logo.className = "landingPageLogo";
    div.appendChild(logo);

    // Header
    const header = document.createElement("h1");
    header.textContent = "EasyBinner";
    header.className = "LandingPageHeader";
    div.appendChild(header);

    // Subheader
    const subheader = document.createElement("h2");
    subheader.textContent = "By Concacore Labs";
    subheader.className = "LandingPageSubheader";
    div.appendChild(subheader);

    // Help text
    const p1 = document.createElement("p");
    p1.textContent = "Please assign fields to all three roles: 'Field to bin', 'Frequency measure', and 'Value'. Reusing the same field or measure across multiple roles is allowed.";
    p1.className = "LandingPageHelpText";
    div.appendChild(p1);

    // Documentation button
    const docButton = document.createElement("button");
    docButton.className = "landingPageLinkButton";
    docButton.textContent = "Documentation";
    docButton.onclick = () => host.launchUrl("https://github.com/vinzzent/simple-binned-chart#readme");
    div.appendChild(docButton);


    // Contact link
    const contactLink = document.createElement("a");
    contactLink.href = "mailto:vvborries@gmail.com";
    contactLink.textContent = "Contact";
    contactLink.title = "Ctrl+Click to open your default email client";
    contactLink.className = "landingPageLinkButton";
    contactLink.style.display = "block";  // to keep layout consistent
    contactLink.style.marginTop = "10px";
    div.appendChild(contactLink);

    return div;
}

// #endregion