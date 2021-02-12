import React, { useState, useMemo, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import styled from "styled-components";
import { HelpBaseURL } from "constants/HelpConstants";
import { AppState } from "reducers";
import SearchModal from "./SearchModal";
import AlgoliaSearchWrapper from "./AlgoliaSearchWrapper";
import SearchBox from "./SearchBox";
import SearchResults from "./SearchResults";
import ContentView from "./ContentView";
import GlobalSearchHotKeys from "./GlobalSearchHotKeys";
import SearchContext from "./GlobalSearchContext";
import { getActions, getAllPageWidgets } from "selectors/entitiesSelector";
import { useNavigateToWidget } from "pages/Editor/Explorer/Widgets/WidgetEntity";
import { toggleShowGlobalSearchModal } from "actions/globalSearchActions";
import { getItemType, SEARCH_ITEM_TYPES } from "./utils";
import { getActionConfig } from "pages/Editor/Explorer/Actions/helpers";
import { useParams } from "react-router";
import { ExplorerURLParams } from "pages/Editor/Explorer/helpers";
import history from "utils/history";

const StyledContainer = styled.div`
  width: 660px;
  height: 40vh;
  background: ${(props) => props.theme.colors.globalSearch.containerBackground};
  box-shadow: ${(props) => props.theme.colors.globalSearch.containerShadow};
  display: flex;
  flex-direction: column;
  & .main {
    display: flex;
    flex: 1;
    overflow: hidden;
    margin: ${(props) => props.theme.spaces[3]}px 0;
  }
`;

const Separator = styled.div`
  width: 1px;
  background-color: ${(props) => props.theme.colors.globalSearch.separator};
`;

const isModalOpenSelector = (state: AppState) =>
  state.ui.globalSearch.modalOpen;
const GlobalSearch = () => {
  const params = useParams<ExplorerURLParams>();
  const dispatch = useDispatch();
  const toggleShow = () => dispatch(toggleShowGlobalSearchModal());
  const [query, setQuery] = useState("");
  const [documentationSearchResults, setDocumentationSearchResults] = useState<
    Array<any>
  >([]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const allWidgets = useSelector(getAllPageWidgets);
  const actions = useSelector(getActions);
  const modalOpen = useSelector(isModalOpenSelector);

  const filteredWidgets = useMemo(() => {
    if (!query) return allWidgets;

    return allWidgets.filter(
      (widget: any) =>
        widget.widgetName.toLowerCase().indexOf(query.toLocaleLowerCase()) > -1,
    );
  }, [allWidgets, query]);
  const filteredActions = useMemo(() => {
    if (!query) return actions;

    return actions.filter(
      (action: any) =>
        action.config.name.toLowerCase().indexOf(query.toLocaleLowerCase()) >
        -1,
    );
  }, [actions, query]);

  const searchResults = useMemo(() => {
    return [
      ...documentationSearchResults,
      ...filteredWidgets,
      ...filteredActions,
    ];
  }, [filteredWidgets, filteredActions, documentationSearchResults]);

  const activeItem = useMemo(() => {
    return searchResults[activeItemIndex] || {};
  }, [searchResults, activeItemIndex]);

  const getNextActiveItem = useCallback(
    (nextIndex: number) => {
      const max = Math.max(searchResults.length - 1, 0);
      if (nextIndex < 0) return 0;
      else if (nextIndex > max) return max;
      else return nextIndex;
    },
    [searchResults],
  );

  // eslint-disable-next-line
  const handleUpKey = () =>
    setActiveItemIndex(getNextActiveItem(activeItemIndex - 1));

  // eslint-disable-next-line
  const handleDownKey = () =>
    setActiveItemIndex(getNextActiveItem(activeItemIndex + 1));

  const { navigateToWidget } = useNavigateToWidget();

  const handleDocumentationItemClick = useCallback((item: any) => {
    window.open(item.path.replace("master", HelpBaseURL), "_blank");
  }, []);

  const handleWidgetClick = useCallback(
    (activeItem) => {
      toggleShow();
      navigateToWidget(
        activeItem.widgetId,
        activeItem.type,
        activeItem.pageId,
        false,
        activeItem.parentModalId,
      );
    },
    [navigateToWidget],
  );

  const handleActionClick = useCallback((item) => {
    const { config } = item;
    const { pageId, pluginType, id } = config;
    const actionConfig = getActionConfig(pluginType);
    const url = actionConfig?.getURL(params.applicationId, pageId, id);
    toggleShow();
    url && history.push(url);
  }, []);

  const itemClickHandlerByType = {
    [SEARCH_ITEM_TYPES.documentation]: handleDocumentationItemClick,
    [SEARCH_ITEM_TYPES.widget]: handleWidgetClick,
    [SEARCH_ITEM_TYPES.action]: handleActionClick,
  };

  const handleItemLinkClick = useCallback(
    (item?: any) => {
      const _item = item || activeItem;
      const type = getItemType(_item) as SEARCH_ITEM_TYPES;
      itemClickHandlerByType[type](_item);
    },
    [activeItem],
  );

  const searchContext = useMemo(() => {
    return {
      handleItemLinkClick,
      setActiveItemIndex,
    };
  }, [handleItemLinkClick, setActiveItemIndex]);

  const hotKeyProps = useMemo(() => {
    return {
      modalOpen,
      toggleShow,
      handleUpKey,
      handleDownKey,
      handleItemLinkClick,
    };
  }, [modalOpen, toggleShow, handleUpKey, handleDownKey, handleItemLinkClick]);

  return (
    <SearchContext.Provider value={searchContext}>
      <GlobalSearchHotKeys {...hotKeyProps}>
        <SearchModal toggleShow={toggleShow} modalOpen={modalOpen}>
          <AlgoliaSearchWrapper query={query}>
            <StyledContainer>
              <SearchBox query={query} setQuery={setQuery} />
              <div className="main">
                <SearchResults
                  activeItemIndex={activeItemIndex}
                  searchResults={searchResults}
                  setDocumentationSearchResults={setDocumentationSearchResults}
                  query={query}
                />
                <Separator />
                <ContentView
                  activeItemIndex={activeItemIndex}
                  searchResults={searchResults}
                />
              </div>
            </StyledContainer>
          </AlgoliaSearchWrapper>
        </SearchModal>
      </GlobalSearchHotKeys>
    </SearchContext.Provider>
  );
};

export default GlobalSearch;
