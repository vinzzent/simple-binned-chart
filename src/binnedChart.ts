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

import "./../style/visual.less";

// powerbi.visuals
import IVisual = powerbi.extensibility.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualEventService = powerbi.extensibility.IVisualEventService;

type Formatter = ReturnType<typeof valueFormatter.create>;

// Interface for pairing original data points before binning
interface PreBinnedDataPoint {
    binValue: number;
    measureValue: number;
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

enum VisualState {
    Landing,
    Error,
    Chart
}

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
    private formatters?: {
        forCategory: Formatter,
        forMeasure: Formatter
    };

    static Config = {
        solidOpacity: 1,
        transparentOpacity: 0.4,
        margins: { top: 30, right: 30, bottom: 30, left: 50, },
        labelCharHeight: 10,
        yMaxMultiplier: 1.1,
    };

    constructor(options: VisualConstructorOptions) {
        this.element = options.element;
        this.host = options.host;
        this.events = options.host.eventService;

        this.element.setAttribute('tabindex', '0');

        this.svg = d3Select(this.element).append("svg").classed("binnedBarChart", true);
        this.barContainer = this.svg.append("g").classed("barContainer", true);
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

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        const dataView = options.dataViews[0];

        const width = options.viewport.width;
        const height = options.viewport.height;
        this.svg.attr("width", width).attr("height", height);

        // --- STATE DETERMINATION ---
        // This block determines the single, correct state for the visual based on the dataView.
        // This prevents race conditions and intermediate states from causing blank screens.
        let currentState: VisualState;
        let validationMessage: string = "";

        const hasCategories = dataView?.categorical?.categories?.length > 0;
        const hasValues = dataView?.categorical?.values?.length > 0;
        const isCategoryNumeric = dataView?.categorical?.categories?.[0]?.source.type.numeric === true;

        if (!hasCategories && !hasValues) {
            currentState = VisualState.Landing;
        } else if (!hasCategories || !isCategoryNumeric) {
            currentState = VisualState.Error;
            validationMessage = "'Field to bin' must be a numeric field.";
        } else if (!hasValues) {
            currentState = VisualState.Error;
            validationMessage = "'Value' must be a numeric measure.";
        } else {
            currentState = VisualState.Chart;
        }

        // --- STATE RENDERER ---
        // This switch statement acts on the determined state, ensuring only one
        // rendering path is executed per update cycle.
        switch (currentState) {
            case VisualState.Landing:
                this.svg.classed("hidden", true);
                this.clearVisual();
                this.showLandingPage();
                console.log("Landing page");
                break;

            case VisualState.Error:
                this.svg.classed("hidden", false);
                this.hideLandingPage();
                this.clearVisual();
                this.displayValidationError(validationMessage);
                console.log("Error message");
                break;

            case VisualState.Chart:
                this.svg.classed("hidden", false);
                this.hideLandingPage();
                this.svg.select(".validation-error").remove(); // Clear any previous error messages

                console.log("Chart display");
                this.formatters = {
                    forCategory: valueFormatter.create({
                        format: dataView.categorical.categories[0].source.format,
                    }),
                    forMeasure: valueFormatter.create({
                        format: dataView.categorical.values[0].source.format,
                    }),
                };

                this.renderChart(dataView, width, height);
                break;
        }

        this.events.renderingFinished(options);
    }

    private renderChart(dataView: powerbi.DataView, width: number, height: number) {
        // This function encapsulates all logic for processing data and drawing the chart.
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(BinnedChartSettingsModel, dataView);
        this.formattingSettings.updateAllSlices();

        const margins = BinnedChart.Config.margins;

        const preBinnedData: PreBinnedDataPoint[] = [];
        const categories = dataView.categorical.categories[0];
        const values = dataView.categorical.values[0];
        const tooltipData = dataView.categorical.values.find(val => val.source.roles.tooltips);

        for (let i = 0; i < categories.values.length; i++) {
            const binValue = categories.values[i] as number;
            const measureValue = values.values[i] as number;
            if (typeof binValue === 'number' && typeof measureValue === 'number') {
                preBinnedData.push({
                    binValue,
                    measureValue,
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

        const dataDomain: [number, number] = [
            d3.min(preBinnedData, d => d.binValue) as number,
            d3.max(preBinnedData, d => d.binValue) as number
        ];

        let binSize: number;
        const binMode = this.formattingSettings.bins.binMode.value;

        if (binMode === "bySize") {
            binSize = this.formattingSettings.bins.binSize.value;
        } else { // Handles 'automatic' and 'byCount'
            let numBins: number;
            if (binMode === "automatic") {
                const sampleSize = this.formattingSettings.bins.sampleSize.value;
                numBins = Math.max(1, Math.ceil(Math.log2(sampleSize) + 1));
            } else { // 'byCount'
                numBins = this.formattingSettings.bins.numberOfBins.value;
            }
            binSize = (dataDomain[1] - dataDomain[0]) / numBins;
        }

        const alignedMin = Math.floor(dataDomain[0] / binSize) * binSize;
        const alignedMax = Math.ceil(dataDomain[1] / binSize) * binSize;
        const thresholds = d3.range(alignedMin, alignedMax, binSize);
        const alignedMaxCorr = thresholds.length > 0 ? thresholds[thresholds.length - 1] + binSize : alignedMin + binSize;
        const niceDomain: [number, number] = [alignedMin, alignedMaxCorr];
        const niceXScale = d3.scaleLinear().domain(niceDomain);

        const histogram = d3.bin<PreBinnedDataPoint, number>()
            .value(d => d.binValue)
            .domain(niceDomain)
            .thresholds(thresholds);

        //const valueFormatterForMeasure = valueFormatter.create({ format: values.source.format });
        //const valueFormatterForCategory = valueFormatter.create({ format: categories.source.format });

        const bins: BinnedDataPoint[] = histogram(preBinnedData).map((bin: d3.Bin<PreBinnedDataPoint, number>) => {
            const aggregatedValue = d3.sum(bin, d => d.measureValue);
            const selectionIds = bin.map(d => d.selectionId);

            const currentBinSize = (bin.x1 ?? 0) - (bin.x0 ?? 0);
            //const binRange = `${valueFormatter.format(bin.x0, "0.##")} - ${valueFormatter.format(bin.x1, "0.##")}`;
            const binRange = `${this.formatters.forCategory.format(bin.x0)} - ${this.formatters.forCategory.format(bin.x1)}`;
            let tooltips: VisualTooltipDataItem[] = [
                { displayName: "Bin range", value: binRange },
                { displayName: "Bin size", value: valueFormatter.format(currentBinSize, "0.###") },
                { displayName: values.source.displayName, value: this.formatters.forMeasure.format(aggregatedValue) },
            ];

            if (tooltipData) {
                const tooltipFormatter = valueFormatter.create({ format: tooltipData.source.format });
                const aggregatedTooltipValue = d3.sum(bin, d => d.tooltipValue as number);
                tooltips.push({
                    displayName: tooltipData.source.displayName,
                    value: tooltipFormatter.format(aggregatedTooltipValue)
                });
            }

            return Object.assign(bin, {
                aggregatedValue,
                selectionIds,
                tooltips,
                color: this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : this.formattingSettings.bars.fill.value.value
            });
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
        // START: Apply Y-axis font settings
        const yTickFontSettings = this.formattingSettings.bars.yTickFont;
        this.yAxis.selectAll("text")
            .style("font-family", yTickFontSettings.fontFamily.value)
            .style("font-size", `${yTickFontSettings.fontSize.value}px`)
            .style("font-weight", yTickFontSettings.bold.value ? "bold" : "normal")
            .style("font-style", yTickFontSettings.italic.value ? "italic" : "normal")
            .style("fill", "#333"); // Default color
        // END: Apply Y-axis font settings

        if (this.formattingSettings.bins.xAxisLabelsType.value === "tickValue") {
            this.customXAxisLabels.selectAll("*").remove();
            const tickValues = bins.length > 0 ? bins.map(d => d.x0).concat(bins[bins.length - 1].x1 ?? 0) : [];
            const xAxis = d3.axisBottom(xScale).tickValues(tickValues as number[]).tickFormat(d => this.formatters.forCategory.format(d));
            this.xAxis
                .attr("transform", `translate(${margins.left}, ${heightWithMargin + margins.top})`)
                .call(xAxis);
            // START: Apply X-axis tick font settings
            const xTickFontSettings = this.formattingSettings.bins.binLabelFont;
            this.xAxis.selectAll("text")
                .style("font-family", xTickFontSettings.fontFamily.value)
                .style("font-size", `${xTickFontSettings.fontSize.value}px`)
                .style("font-weight", xTickFontSettings.bold.value ? "bold" : "normal")
                .style("font-style", xTickFontSettings.italic.value ? "italic" : "normal")
                .style("fill", "#333");
            // END: Apply X-axis tick font settings
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

    private renderBars(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, heightWithMargin: number) {
        const bars = this.barContainer.selectAll("rect").data(bins);

        const valueFormatterForAria = valueFormatter.create({ format: "0.##" });
        bars.enter()
            .append("rect")
            .merge(bars as any)
            .attr("x", (d: BinnedDataPoint) => xScale(d.x0!) + 1)
            .attr("y", (d: BinnedDataPoint) => yScale(d.aggregatedValue))
            .attr("width", (d: BinnedDataPoint) => Math.max(0, xScale(d.x1!) - xScale(d.x0!) - 1))
            .attr("height", (d: BinnedDataPoint) => heightWithMargin - yScale(d.aggregatedValue))
            .attr("tabindex", 0)
            .attr("role", "listitem")
            .attr("aria-label", (d: BinnedDataPoint) => `Bin from ${valueFormatterForAria.format(d.x0)} to ${valueFormatterForAria.format(d.x1)}: value ${valueFormatterForAria.format(d.aggregatedValue)}`)
            .style("fill", (d: BinnedDataPoint) => d.color)
            .style("stroke", this.host.colorPalette.isHighContrast ? this.host.colorPalette.background.value : null)
            .style("stroke-width", this.host.colorPalette.isHighContrast ? "2px" : null);

        this.tooltipServiceWrapper.addTooltip(
            this.barContainer.selectAll("rect"),
            (d: BinnedDataPoint) => d.tooltips
        );

        this.setupInteractivity(bars, bins);

        bars.exit().remove();
    }

    private setupInteractivity(bars: d3.Selection<d3.BaseType, BinnedDataPoint, SVGGElement, unknown>, bins: BinnedDataPoint[]) {
        const selectionManager = this.selectionManager;
        const allowInteractions = this.host.hostCapabilities.allowInteractions;

        this.element.onkeydown = (event: KeyboardEvent) => {
            if (!allowInteractions || event.key !== "Enter") {
                return;
            }
            const firstBar = this.barContainer.select("rect").node() as HTMLElement;
            if (firstBar) {
                firstBar.focus();
            }
            event.preventDefault();
        };

        bars.on("focus", function () {
            d3.select(this).classed("keyboard-focus", true);
        });

        bars.on("blur", function () {
            d3.select(this).classed("keyboard-focus", false);
        });

        bars.on("click", (event: MouseEvent, d: BinnedDataPoint) => {
            if (allowInteractions) {
                selectionManager.select(d.selectionIds, event.ctrlKey).then((ids: ISelectionId[]) => {
                    syncSelectionState(bars, ids);
                });
                event.stopPropagation();
            }
        });

        bars.on("keydown", (event: KeyboardEvent, d: BinnedDataPoint) => {
            if (!allowInteractions) return;

            const currentBarIndex = bins.indexOf(d);

            switch (event.key) {
                case "Enter":
                case " ":
                    selectionManager.select(d.selectionIds, event.ctrlKey).then((ids: ISelectionId[]) => {
                        syncSelectionState(bars, ids);
                    });
                    event.preventDefault();
                    break;
                case "ArrowRight":
                    const nextIndex = (currentBarIndex + 1) % bins.length;
                    (bars.nodes()[nextIndex] as HTMLElement).focus();
                    event.preventDefault();
                    break;
                case "ArrowLeft":
                    const prevIndex = (currentBarIndex - 1 + bins.length) % bins.length;
                    (bars.nodes()[prevIndex] as HTMLElement).focus();
                    event.preventDefault();
                    break;
                case "Escape":
                    selectionManager.clear();
                    //this.focusedBarIndex = null;
                    this.element.focus();
                    event.preventDefault();
                    break;
            }
        });

        syncSelectionState(bars, selectionManager.getSelectionIds() as ISelectionId[]);

        this.svg.on("click", () => {
            if (allowInteractions) {
                selectionManager.clear().then(() => {
                    bars.style("fill-opacity", BinnedChart.Config.solidOpacity);
                });
            }
        });
    }

    private calculateLabelSettings(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>) {
        let useVerticalLabels = false;
        let bottomMargin = BinnedChart.Config.margins.bottom;

        const isBinRange = this.formattingSettings.bins.xAxisLabelsType.value === "binRange";
        if (isBinRange) {
            //const labels = bins.map(bin => `${valueFormatter.format(bin.x0, "0.##")} - ${valueFormatter.format(bin.x1, "0.##")}`);
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

    private renderCustomXAxisLabels(bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, topPosition: number, useVertical: boolean) {
        this.customXAxisLabels.attr("transform", `translate(${BinnedChart.Config.margins.left}, ${topPosition})`);
        const labels = this.customXAxisLabels.selectAll("text").data(bins);

        // START: Apply custom X-axis label font settings
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
        // END: Apply custom X-axis label font settings

        labels.exit().remove();
    }

    private renderNormalCurve(data: PreBinnedDataPoint[], bins: BinnedDataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, margins) {
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

        const curveData = xScale.ticks(100).map(x => ({
            x: x,
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
        this.curveMarkersContainer.raise();

        this.curveMarkersContainer.attr("transform", `translate(${margins.left}, ${margins.top})`);

        const markers = this.curveMarkersContainer.selectAll("circle").data(curveData);

        // Create and position the invisible hover targets
        markers.enter()
            .append("circle")
            .merge(markers as any)
            .attr("cx", d => xScale(d.x))
            .attr("cy", d => yScale(d.y))
            .attr("r", 5) // Set a reasonable radius for hovering
            .style("fill", "transparent");

        //const valueFormatterForTooltip = valueFormatter.create({ format: "0.##" });

        // Add the tooltip to the selection of invisible markers
        this.tooltipServiceWrapper.addTooltip(
            this.curveMarkersContainer.selectAll("circle"),
            (d: { x: number, y: number }) => {
                const expectedValue = d.y;

                return [
                    { displayName: "Mean", value: this.formatters.forMeasure.format(mean) },
                    { displayName: "Standard Deviation", value: this.formatters.forMeasure.format(stdDev) },
                    { displayName: "Expected Value", value: this.formatters.forMeasure.format(expectedValue) }
                ];
            }
        );

        markers.exit().remove();
    }

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

    private showLandingPage() {
        console.log("showLandingPage called. isLandingPageOn is:", this.isLandingPageOn);
        if (!this.isLandingPageOn) {
            this.isLandingPageOn = true;
            //this.clearVisual();
            const landingPageElement = createLandingPage();
            this.element.appendChild(landingPageElement);
            this.LandingPage = d3Select(landingPageElement);
        }
        console.log("showLandingPage called after. isLandingPageOn is:", this.isLandingPageOn);
    }

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
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}

function syncSelectionState(selection: d3.Selection<d3.BaseType, BinnedDataPoint, any, any>, selectionIds: ISelectionId[]): void {
    if (!selection || !selectionIds) {
        return;
    }

    selection.style("fill-opacity", (d: BinnedDataPoint) => {
        const isSelected = d.selectionIds.some(binId => selectionIds.some(selectedId => selectedId.includes(binId)));
        if (selectionIds.length > 0) {
            return isSelected ? BinnedChart.Config.solidOpacity : BinnedChart.Config.transparentOpacity;
        }
        return BinnedChart.Config.solidOpacity;
    });
}

function createLandingPage(): Element {
    const div = document.createElement("div");
    const logo = document.createElement("img");
    // Your SVG string (minified, no line breaks)
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 1024 1024"><path fill="#ed4341" d="M532 216.439c-19.352 3.046-36.009 14.355-49.996 27.472C459.08 265.41 441.642 291.848 426.15 319c-60.092 105.325-85.907 226.475-147.753 331-20.561 34.75-46.437 67.955-80.397 90.484-7.992 5.302-17.108 9.905-26 13.501-4.2 1.698-8.986 2.29-12.941 4.548-4.702 2.685-5.655 10.542.96 11.279 3.781.421 7.543-1.482 10.981-2.762 6.881-2.562 13.454-5.478 20-8.806 31.625-16.077 57.306-42.976 78.116-71.244 16.897-22.953 30.416-48.57 43.131-74 44.281-88.562 68.818-186.276 116.892-273 18.402-33.198 37.515-66.949 66.861-91.866 16.297-13.837 37.292-24.405 59-18.389 18.802 5.211 34.397 17.956 47.166 32.255 21.558 24.142 38.641 52.12 53.081 81 52.141 104.282 80.435 219.606 140.553 320 23.197 38.738 51.134 74.899 89.2 99.997 9.066 5.977 18.932 11.44 29 15.551 3.417 1.395 8.126 3.876 11.906 2.975 7.563-1.802 3.819-9.21-.911-11.618-14.045-7.15-28.047-13.039-40.995-22.333-30.111-21.616-54.376-52.036-73.399-83.572-67.892-112.553-95.338-243.297-160.751-357-4.324-7.517-9.025-14.797-13.851-22-22.51-33.6-58.507-75.722-103.999-68.561z"/><path fill="#21a7e9" d="M483 243c14.214-9.895 26.425-21.326 44-25-3.435-1.441-7.298-1-11-1h-21c-3.341 0-8.8-.937-10.972 2.318-1.416 2.122-1.023 5.267-1.028 7.682v16m50-14.536c-14.671 2.592-27.86 10.976-39 20.537-3.925 3.368-9.535 6.951-11.397 11.999-2.469 6.694-.603 16.91-.603 24v483c0 3.241-.722 7.833 1.179 10.682C485.953 782.838 495.686 781 500 781h36c5.243 0 11.863 1.077 16.941-.318 3.734-1.025 3.992-4.346 4.054-7.682.138-7.328.005-14.671.005-22V238c-.005-2.216.457-5.391-1.028-7.262-3.731-4.7-17.806-3.187-22.972-2.274M375 426c4.563-3.113 5.821-10.065 7.861-15 5.158-12.48 12.413-25.068 16.139-38-5.41 0-18.17-2.346-22.258 1.742C373.663 377.821 375 385.051 375 389v37m37.638-51.972c-4.202 2.948-6.658 12.357-8.637 16.972-6.276 14.634-12.682 29.215-18.601 44-3.445 8.604-8.541 17.818-10.074 27-1.338 8.009-.326 16.891-.326 25v282c0 2.746-.524 6.269.603 8.852C377.801 782.886 387.591 781 392 781h40c4.285 0 11.966 1.452 15.682-1.028 2.32-1.548 2.267-4.488 2.313-6.972.107-5.662.005-11.336.005-17V390c0-4.406 1.481-12.196-2.318-15.397C443.471 371.055 433.187 373 428 373c-4.148 0-11.811-1.463-15.362 1.028m177.68 39c-2.32 1.548-2.267 4.488-2.313 6.972-.107 5.662-.005 11.336-.005 17v318c0 6.445-1.997 16.896.603 22.852C590.801 782.886 600.591 781 605 781h40c4.285 0 11.966 1.452 15.682-1.028 2.32-1.548 2.267-4.488 2.313-6.972.107-5.662.005-11.336.005-17V438c0-6.445 1.997-16.896-.603-22.852C660.199 410.114 650.409 412 646 412h-40c-4.285 0-11.966-1.452-15.682 1.028m105 130C691.038 545.884 693 556.542 693 561v204c0 3.904-1.159 10.101.603 13.682C695.664 782.869 706.139 781 710 781h40c4.285 0 11.966 1.452 15.682-1.028C769.58 777.371 768 769.011 768 765v-45c0-26.694.205-53.38-.961-80-.437-10 1.657-21.193-.429-31-2.605-12.254-10.816-24.411-15.599-36-2.759-6.684-5.681-13.303-8.408-20-1.195-2.935-2.1-7.122-4.421-9.397-2.449-2.4-7.063-1.603-10.182-1.603h-23c-2.917 0-7.118-.683-9.682 1.028M751 542c2.259 13.121 10.206 25.642 15 38 3.104-7.397 1.004-18.995 1-27-.001-2.886.652-7.141-1.603-9.397C762.38 540.587 754.911 542 751 542M271 662c10.124-10.777 16.314-27.067 23.309-40 5.069-9.373 11.859-19.359 13.691-30h-24c-3.156 0-7.912-.821-10.682 1.028C269.038 595.884 271 606.542 271 611v51m51.637-68.972c-3.583 2.502-5.493 9.178-7.39 12.972-5.038 10.075-10.363 19.981-15.492 30-5.254 10.265-11.131 20.331-17.412 30-3.533 5.44-9.031 11.741-10.833 18-1.653 5.74-.51 13.065-.51 19v63c0 3.562-.853 8.516.603 11.852C273.801 782.886 283.591 781 288 781h39c4.285 0 11.966 1.452 15.682-1.028C346.118 777.679 345 771.52 345 768V612c0-4.805.691-10.226-.228-14.956-1.292-6.643-9.694-5.054-14.772-5.044-2.334.005-5.333-.389-7.363 1.028M167 756c20.991-5.741 39.968-20.151 56-34.286 6.025-5.311 14.815-12.191 18.062-19.714 2.065-4.787.811-11.022.223-16-.518-4.395 1.28-11.8-1.313-15.566C237.264 666.499 229.087 668 225 668h-41c-4.164 0-13.282-1.714-15.972 2.318-1.416 2.122-1.023 5.267-1.028 7.682v78m646-88c5.077 10.861 13.049 20.564 20.349 30 10.932 14.128 23.346 30.427 38.651 40v-50c0-4.921 1.892-14.849-2.318-18.397C866.068 666.558 858.404 668 854 668h-41m-13 1c-5.436 3.92-3 15.862-3 22v65c0 5.991-.173 12.011.015 17.999.078 2.462.177 5.279 2.419 6.822C803.181 783.4 810.667 782 815 782h39c4.603 0 12.914 1.572 16.682-1.603 4.351-3.666 3-18.179 2.17-23.382-.877-5.499-7.075-8.609-10.852-12.104-9.331-8.632-18.294-17.231-26.572-26.911-13.223-15.462-24.233-32.081-35.428-49m-559 50c-15.043 15.043-30.969 28.918-50 38.742-5.558 2.869-11.16 5.583-16.999 7.834-2.571.99-5.789 1.684-6.683 4.649-.842 2.791-.899 8.642 2.116 10.172 4.368 2.216 12.745.603 17.566.603h36c4.621 0 11.55 1.275 15.852-.603C243.586 778.33 242 770.135 242 766v-31c0-5.08.981-11.28-1-16z"/></svg>`;
    // URI encode the SVG string to safely embed it in a URL
    const encodedSvg = encodeURIComponent(svgString);
    // Set the src attribute with a URI-encoded SVG data URI
    logo.src = `data:image/svg+xml;utf8,${encodedSvg}`;
    logo.alt = "Visual logo";
    logo.style.display = "block";
    logo.style.margin = "20px auto";
    // The rest stays the same
    const header = document.createElement("h1");
    header.textContent = "Simple Binned Chart";
    header.className = "LandingPage";
    const p1 = document.createElement("p");
    p1.textContent = "Please provide data to both 'Field to bin' and 'Value'.";
    p1.className = "LandingPageHelpLink";
    const websiteLink = document.createElement("a"); websiteLink.href = "#";
    websiteLink.textContent = "Website";
    websiteLink.style.display = "block";
    websiteLink.style.textAlign = "center";
    websiteLink.style.marginTop = "30px";
    const contactLink = document.createElement("a");
    contactLink.href = "mailto:contact@example.com";
    contactLink.textContent = "Contact";
    contactLink.style.display = "block";
    contactLink.style.textAlign = "center";
    contactLink.style.marginTop = "10px";
    div.appendChild(logo);
    div.appendChild(header);
    div.appendChild(p1);
    div.appendChild(websiteLink);
    div.appendChild(contactLink);
    return div;
}